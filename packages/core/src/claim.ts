import { Prisma, PrismaClient, Job } from "@jsp/db";

export const DEFAULT_LOCK_DURATION_MS = 60_000;

/**
 * Atomically claims up to `limit` due jobs from a single queue for a worker.
 *
 * This is the single most important correctness guarantee in the whole
 * system: it must be impossible for two workers to claim the same job.
 *
 * Implemented as one statement — a `FOR UPDATE SKIP LOCKED` CTE feeding an
 * `UPDATE ... FROM` — rather than a SELECT followed by an UPDATE. Postgres
 * executes the whole thing as a single atomic operation, so there is no
 * window between "pick a row" and "mark it claimed" for a second worker to
 * race into. `SKIP LOCKED` means concurrent claims against the same queue
 * fan out across distinct rows instead of blocking on each other, which is
 * what lets many workers poll the same queue concurrently without becoming
 * a bottleneck.
 */
export async function claimDueJobs(
  prisma: PrismaClient,
  params: { queueId: string; workerId: string; limit: number; lockDurationMs?: number }
): Promise<Job[]> {
  const { queueId, workerId, limit } = params;
  if (limit <= 0) return [];
  const lockDurationMs = params.lockDurationMs ?? DEFAULT_LOCK_DURATION_MS;

  const claimed = await prisma.$queryRaw<Job[]>(Prisma.sql`
    WITH candidate AS (
      SELECT id FROM jobs
      WHERE queue_id = ${queueId}
        AND status = 'QUEUED'
        AND run_at <= now()
      ORDER BY priority DESC, run_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE jobs
    SET status = 'CLAIMED',
        claimed_by_worker_id = ${workerId},
        claimed_at = now(),
        lock_expires_at = now() + (${lockDurationMs}::text || ' milliseconds')::interval,
        updated_at = now()
    FROM candidate
    WHERE jobs.id = candidate.id
    RETURNING jobs.*;
  `);

  return claimed;
}

/** Active (in-flight) job count for a queue — used to respect `concurrencyLimit`. */
export async function activeJobCountForQueue(prisma: PrismaClient, queueId: string): Promise<number> {
  return prisma.job.count({
    where: { queueId, status: { in: ["CLAIMED", "RUNNING"] } },
  });
}

/** Marks a claimed job RUNNING and records the execution attempt has started. */
export async function startExecution(prisma: PrismaClient, jobId: string, workerId: string, attemptNumber: number) {
  const [, execution] = await prisma.$transaction([
    prisma.job.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date(), attempt: attemptNumber },
    }),
    prisma.jobExecution.create({
      data: { jobId, workerId, attemptNumber, status: "RUNNING" },
    }),
  ]);
  return execution;
}
