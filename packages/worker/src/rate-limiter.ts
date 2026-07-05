import type Redis from "ioredis";

/**
 * Distributed per-queue rate limiter: fixed 1-second windows keyed by
 * queueId, shared across every worker process via Redis so a queue's
 * `rateLimitPerSecond` is enforced fleet-wide, not per-worker.
 *
 * Reserves up to `want` slots for the current second and returns how many
 * were actually granted. Implemented as INCRBY-then-correct rather than a
 * Lua script for simplicity — the brief over-increment window this allows
 * is bounded (at most one extra INCRBY/DECRBY round trip) and self-heals
 * every second, which is an acceptable trade-off for a rate limiter that
 * only needs to be approximately fair, not exact.
 */
export async function reserveRateLimitSlots(redis: Redis, queueId: string, ratePerSecond: number, want: number): Promise<number> {
  if (want <= 0) return 0;
  const key = `jsp:ratelimit:${queueId}:${Math.floor(Date.now() / 1000)}`;

  const total = await redis.incrby(key, want);
  await redis.expire(key, 2);

  if (total > ratePerSecond) {
    const excess = Math.min(want, total - ratePerSecond);
    if (excess > 0) await redis.decrby(key, excess);
    return Math.max(0, want - excess);
  }

  return want;
}
