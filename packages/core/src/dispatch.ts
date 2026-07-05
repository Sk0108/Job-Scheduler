import type Redis from "ioredis";
import { Prisma, PrismaClient } from "@jsp/db";
import { getNextCronRun } from "@jsp/shared";
import { publishEvent } from "./events";
import { applyFailureToJob } from "./lifecycle";

/**
 * Promotes SCHEDULED jobs whose `runAt` has arrived to QUEUED so workers can
 * claim them. A job with unmet dependencies (workflow bonus feature) is
 * held back even if its own runAt has passed — the NOT EXISTS subquery
 * excludes any job that still has a dependency whose prerequisite job
 * hasn't reached COMPLETED.
 */
export async function sweepDueScheduledJobs(prisma: PrismaClient, batchSize = 500): Promise<number> {
  const result = await prisma.$executeRaw(Prisma.sql`
    UPDATE jobs
    SET status = 'QUEUED', updated_at = now()
    WHERE id IN (
      SELECT j.id FROM jobs j
      WHERE j.status = 'SCHEDULED'
        AND j.run_at <= now()
        AND NOT EXISTS (
          SELECT 1 FROM job_dependencies jd
          JOIN jobs prereq ON prereq.id = jd.depends_on_job_id
          WHERE jd.job_id = j.id AND prereq.status <> 'COMPLETED'
        )
      LIMIT ${batchSize}
    )
  `);
  return result;
}

/** Spawns the next Job for every due, unpaused cron JobDefinition and advances its nextRunAt. */
export async function dispatchDueCronDefinitions(prisma: PrismaClient, redis?: Redis): Promise<number> {
  const due = await prisma.jobDefinition.findMany({
    where: { isPaused: false, nextRunAt: { lte: new Date() } },
    include: { queue: true },
  });

  for (const def of due) {
    await prisma.$transaction([
      prisma.job.create({
        data: {
          queueId: def.queueId,
          jobDefinitionId: def.id,
          type: def.jobType,
          payload: def.payload as never,
          priority: def.priority,
          status: "QUEUED",
          maxRetries: def.maxRetries,
          retryStrategy: def.retryStrategy,
          baseDelayMs: def.baseDelayMs,
          maxDelayMs: def.maxDelayMs,
          timeoutMs: def.timeoutMs ?? undefined,
        },
      }),
      prisma.jobDefinition.update({
        where: { id: def.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt: getNextCronRun(def.cronExpression, def.timezone),
        },
      }),
    ]);

    await publishEvent(redis, {
      type: "job.queued",
      projectId: def.queue.projectId,
      queueId: def.queueId,
      data: { source: "cron", jobDefinitionId: def.id, name: def.name },
    });
  }

  return due.length;
}

/**
 * Crash recovery: a job claimed by a worker that then died (process kill,
 * OOM, node loses network) would otherwise sit CLAIMED/RUNNING forever.
 * Each claim carries a `lockExpiresAt` renewed by the worker's heartbeat;
 * once it lapses without a heartbeat renewal, the reaper treats it exactly
 * like a failed attempt so it goes through the same retry/DLQ decision as
 * any other failure — a stuck job never silently vanishes or blocks
 * capacity forever.
 */
export async function reapStaleClaims(prisma: PrismaClient, redis?: Redis): Promise<number> {
  const stale = await prisma.job.findMany({
    where: { status: { in: ["CLAIMED", "RUNNING"] }, lockExpiresAt: { lt: new Date() } },
    include: { queue: { include: { defaultRetryPolicy: true } } },
  });

  for (const job of stale) {
    const openExecution = await prisma.jobExecution.findFirst({
      where: { jobId: job.id, status: "RUNNING" },
      orderBy: { startedAt: "desc" },
    });

    if (openExecution) {
      await prisma.jobExecution.update({
        where: { id: openExecution.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: "Worker lock expired without a heartbeat renewal (worker likely crashed).",
        },
      });
    }

    await applyFailureToJob(prisma, redis, job, "Worker lock expired without a heartbeat renewal (worker likely crashed).");
  }

  return stale.length;
}
