import type Redis from "ioredis";
import { PrismaClient, Queue } from "@jsp/db";
import { claimDueJobs, activeJobCountForQueue } from "@jsp/core";
import { reserveRateLimitSlots } from "./rate-limiter";
import { executeJob } from "./executor";
import { Semaphore } from "./pool";
import { logger } from "./logger";

async function getActiveQueues(prisma: PrismaClient, queueFilter: string): Promise<Queue[]> {
  const where = queueFilter === "*" ? { isPaused: false } : { isPaused: false, slug: { in: queueFilter.split(",").map((s) => s.trim()) } };
  return prisma.queue.findMany({ where, orderBy: { priority: "desc" } });
}

export interface PollerDeps {
  prisma: PrismaClient;
  redis: Redis;
  workerId: string;
  semaphore: Semaphore;
  queueFilter: string;
  lockDurationMs: number;
}

/**
 * One polling tick: fan out this worker's remaining local capacity across
 * active queues in priority order, respecting each queue's own
 * `concurrencyLimit` and optional `rateLimitPerSecond`, then hands claimed
 * jobs to the semaphore to execute concurrently.
 */
export async function pollOnce(deps: PollerDeps): Promise<void> {
  const { prisma, redis, workerId, semaphore, queueFilter, lockDurationMs } = deps;

  let remaining = semaphore.available();
  if (remaining <= 0) return;

  const queues = await getActiveQueues(prisma, queueFilter);

  for (const queue of queues) {
    if (remaining <= 0) break;

    const activeInQueue = await activeJobCountForQueue(prisma, queue.id);
    let capacity = Math.min(Math.max(0, queue.concurrencyLimit - activeInQueue), remaining);
    if (capacity <= 0) continue;

    if (queue.rateLimitPerSecond) {
      capacity = await reserveRateLimitSlots(redis, queue.id, queue.rateLimitPerSecond, capacity);
    }
    if (capacity <= 0) continue;

    const claimed = await claimDueJobs(prisma, { queueId: queue.id, workerId, limit: capacity, lockDurationMs });
    for (const job of claimed) {
      remaining--;
      semaphore.run(() =>
        executeJob(prisma, redis, workerId, job, queue.projectId).catch((err) => {
          logger.error({ err, jobId: job.id }, "unhandled error while executing job");
        })
      );
    }
  }
}
