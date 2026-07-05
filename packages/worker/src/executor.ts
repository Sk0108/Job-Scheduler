import type Redis from "ioredis";
import { Job, PrismaClient } from "@jsp/db";
import { startExecution, recordJobSuccess, recordJobFailure, publishEvent } from "@jsp/core";
import { resolveHandler } from "./handlers/registry";
import { logger } from "./logger";

const LOCK_EXTENSION_BUFFER_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 30_000;

class TimeoutError extends Error {}

/** Runs one claimed job end-to-end: start -> handler (with timeout) -> success/failure transition. */
export async function executeJob(prisma: PrismaClient, redis: Redis, workerId: string, job: Job, projectId: string): Promise<void> {
  const attemptNumber = job.attempt + 1;
  const timeoutMs = job.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const execution = await startExecution(prisma, job.id, workerId, attemptNumber);

  // Extend the claim lock to cover the job's full timeout window (plus a buffer) so the
  // stale-lock reaper never reclaims a job that is still legitimately running — the
  // worker's own timeout race below fires well before the reaper's window would.
  await prisma.job.update({
    where: { id: job.id },
    data: { lockExpiresAt: new Date(Date.now() + timeoutMs + LOCK_EXTENSION_BUFFER_MS) },
  });

  await publishEvent(redis, {
    type: "job.started",
    projectId,
    queueId: job.queueId,
    jobId: job.id,
    workerId,
    data: { attempt: attemptNumber },
  });

  const controller = new AbortController();
  const startedAt = Date.now();
  const handler = resolveHandler(job.type);

  const log = async (level: "debug" | "info" | "warn" | "error", message: string, metadata?: Record<string, unknown>) => {
    try {
      await prisma.jobLog.create({
        data: { jobId: job.id, executionId: execution.id, level: level.toUpperCase() as never, message, metadata: metadata as never },
      });
    } catch (err) {
      logger.warn({ err }, "failed to write job log");
    }
  };

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`Job exceeded timeoutMs (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([handler({ job, signal: controller.signal, log }), timeoutPromise]);
    clearTimeout(timeoutHandle);

    const durationMs = Date.now() - startedAt;
    await recordJobSuccess(prisma, redis, { jobId: job.id, executionId: execution.id, durationMs, resultPayload: result });
    await log("info", `Job completed in ${durationMs}ms`);
  } catch (err) {
    clearTimeout(timeoutHandle);
    const durationMs = Date.now() - startedAt;
    const timedOut = err instanceof TimeoutError;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;

    await log("error", `Job failed: ${errorMessage}`);
    await recordJobFailure(prisma, redis, {
      jobId: job.id,
      executionId: execution.id,
      durationMs,
      errorMessage,
      errorStack,
      timedOut,
    });
  }
}
