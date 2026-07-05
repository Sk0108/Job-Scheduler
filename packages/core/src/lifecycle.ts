import type Redis from "ioredis";
import { Job, PrismaClient, RetryPolicy, RetryStrategy } from "@jsp/db";
import { computeRetryDelayMs } from "@jsp/shared";
import { publishEvent } from "./events";

export interface ResolvedRetryPolicy {
  strategy: RetryStrategy;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export const SYSTEM_DEFAULT_RETRY_POLICY: ResolvedRetryPolicy = {
  strategy: "EXPONENTIAL",
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 300_000,
  jitter: true,
};

/** Job-level overrides win; otherwise fall back to the queue's default retry policy, then the system default. */
export function resolveRetryPolicy(
  job: Pick<Job, "maxRetries" | "retryStrategy" | "baseDelayMs" | "maxDelayMs">,
  queuePolicy?: Pick<RetryPolicy, "strategy" | "maxRetries" | "baseDelayMs" | "maxDelayMs" | "jitter"> | null
): ResolvedRetryPolicy {
  const base = queuePolicy ?? SYSTEM_DEFAULT_RETRY_POLICY;
  return {
    strategy: job.retryStrategy ?? base.strategy,
    maxRetries: job.maxRetries ?? base.maxRetries,
    baseDelayMs: job.baseDelayMs ?? base.baseDelayMs,
    maxDelayMs: job.maxDelayMs ?? base.maxDelayMs,
    jitter: base.jitter,
  };
}

export interface SuccessInput {
  jobId: string;
  executionId: string;
  durationMs: number;
  resultPayload?: unknown;
}

export async function recordJobSuccess(prisma: PrismaClient, redis: Redis | undefined, input: SuccessInput) {
  const job = await prisma.job.update({
    where: { id: input.jobId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      claimedByWorkerId: null,
      claimedAt: null,
      lockExpiresAt: null,
      lastError: null,
    },
    include: { queue: true },
  });

  await prisma.jobExecution.update({
    where: { id: input.executionId },
    data: {
      status: "COMPLETED",
      finishedAt: new Date(),
      durationMs: input.durationMs,
      resultPayload: (input.resultPayload ?? undefined) as never,
    },
  });

  if (job.batchId) {
    await advanceBatch(prisma, job.batchId);
  }

  await publishEvent(redis, {
    type: "job.completed",
    projectId: job.queue.projectId,
    queueId: job.queueId,
    jobId: job.id,
    data: { durationMs: input.durationMs },
  });

  return job;
}

export interface FailureInput {
  jobId: string;
  executionId: string;
  durationMs: number;
  errorMessage: string;
  errorStack?: string;
  timedOut?: boolean;
}

/**
 * Records a failed attempt and decides the job's fate: another retry
 * (FAILED -> SCHEDULED with a backoff delay) or permanent failure
 * (-> DEAD_LETTER with a DeadLetterEntry snapshot). This is the one place
 * that decision is made, so the normal worker failure path and the stale
 * lock reaper (crash recovery) both funnel through it and can never
 * disagree about when a job has truly exhausted its retries.
 */
export async function recordJobFailure(prisma: PrismaClient, redis: Redis | undefined, input: FailureInput) {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: input.jobId },
    include: { queue: { include: { defaultRetryPolicy: true } } },
  });

  await prisma.jobExecution.update({
    where: { id: input.executionId },
    data: {
      status: input.timedOut ? "TIMED_OUT" : "FAILED",
      finishedAt: new Date(),
      durationMs: input.durationMs,
      errorMessage: input.errorMessage,
      errorStack: input.errorStack,
    },
  });

  return applyFailureToJob(prisma, redis, job, input.errorMessage);
}

/** Shared by the normal failure path and the reaper (which has no fresh execution row to attach the error to). */
export async function applyFailureToJob(
  prisma: PrismaClient,
  redis: Redis | undefined,
  job: Job & { queue: { projectId: string; defaultRetryPolicy: RetryPolicy | null } },
  errorMessage: string
) {
  const policy = resolveRetryPolicy(job, job.queue.defaultRetryPolicy);
  const willRetry = job.attempt < policy.maxRetries;

  if (willRetry) {
    const delayMs = computeRetryDelayMs(policy, job.attempt);
    const runAt = new Date(Date.now() + delayMs);

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "SCHEDULED",
        runAt,
        failedAt: new Date(),
        lastError: errorMessage,
        claimedByWorkerId: null,
        claimedAt: null,
        lockExpiresAt: null,
      },
    });

    await publishEvent(redis, {
      type: "job.retry_scheduled",
      projectId: job.queue.projectId,
      queueId: job.queueId,
      jobId: job.id,
      data: { attempt: job.attempt, nextRunAt: runAt.toISOString(), delayMs },
    });

    return updated;
  }

  const [updated] = await prisma.$transaction([
    prisma.job.update({
      where: { id: job.id },
      data: {
        status: "DEAD_LETTER",
        failedAt: new Date(),
        lastError: errorMessage,
        claimedByWorkerId: null,
        claimedAt: null,
        lockExpiresAt: null,
      },
    }),
    prisma.deadLetterEntry.create({
      data: {
        jobId: job.id,
        queueId: job.queueId,
        reason: "max_retries_exhausted",
        lastError: errorMessage,
        attemptsMade: job.attempt,
        payloadSnapshot: job.payload as never,
      },
    }),
  ]);

  if (job.batchId) {
    await advanceBatch(prisma, job.batchId, { failed: true });
  }

  await publishEvent(redis, {
    type: "job.dead_lettered",
    projectId: job.queue.projectId,
    queueId: job.queueId,
    jobId: job.id,
    data: { attemptsMade: job.attempt, lastError: errorMessage },
  });

  return updated;
}

async function advanceBatch(prisma: PrismaClient, batchId: string, opts: { failed?: boolean } = {}) {
  const batch = await prisma.batch.update({
    where: { id: batchId },
    data: opts.failed ? { failedJobs: { increment: 1 } } : { completedJobs: { increment: 1 } },
  });

  const finished = batch.completedJobs + batch.failedJobs;
  if (finished >= batch.totalJobs && batch.status !== "COMPLETED" && batch.status !== "FAILED" && batch.status !== "PARTIAL") {
    await prisma.batch.update({
      where: { id: batchId },
      data: {
        status: batch.failedJobs === 0 ? "COMPLETED" : batch.completedJobs === 0 ? "FAILED" : "PARTIAL",
        completedAt: new Date(),
      },
    });
  } else if (batch.status === "PENDING") {
    await prisma.batch.update({ where: { id: batchId }, data: { status: "RUNNING" } });
  }
}

/** User-initiated cancel — only meaningful for jobs that haven't reached a terminal state yet. */
export async function cancelJob(prisma: PrismaClient, jobId: string) {
  return prisma.job.updateMany({
    where: { id: jobId, status: { in: ["QUEUED", "SCHEDULED", "FAILED"] } },
    data: { status: "CANCELLED" },
  });
}

/** Manual retry from the dashboard: resets attempt count and re-queues immediately. Works from FAILED or DEAD_LETTER. */
export async function requeueJob(prisma: PrismaClient, jobId: string, opts: { resetAttempts?: boolean } = {}) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  if (!["DEAD_LETTER", "FAILED", "CANCELLED"].includes(job.status)) {
    throw new Error(`Job ${jobId} is not in a retryable state (status=${job.status})`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.job.update({
      where: { id: jobId },
      data: {
        status: "QUEUED",
        runAt: new Date(),
        attempt: opts.resetAttempts === false ? job.attempt : 0,
        lastError: null,
        failedAt: null,
        claimedByWorkerId: null,
        claimedAt: null,
        lockExpiresAt: null,
      },
    });

    if (job.status === "DEAD_LETTER") {
      await tx.deadLetterEntry.updateMany({
        where: { jobId, resolvedAt: null },
        data: { resolvedAt: new Date(), resolution: "requeued" },
      });
    }

    return updated;
  });
}
