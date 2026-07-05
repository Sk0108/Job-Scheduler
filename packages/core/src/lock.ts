import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Redis-based distributed mutex (SET NX PX + a token-checked release script
 * so a process can never release a lock it doesn't currently hold, e.g.
 * after its own lock already expired and someone else acquired it).
 *
 * The scheduler is the reason this exists: it's meant to run as a single
 * logical process but nothing stops an operator from running two replicas
 * for HA. Without mutual exclusion, two replicas ticking at once could both
 * see the same due cron JobDefinition and each spawn a Job before either
 * updates `nextRunAt` — a real duplicate-execution bug, not just a
 * theoretical one. Wrapping each tick in `withLock` makes only one replica
 * do the work; the other's tick becomes a harmless no-op.
 */
export async function withLock<T>(redis: Redis, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
  const token = randomUUID();
  const acquired = await redis.set(key, token, "PX", ttlMs, "NX");
  if (!acquired) return undefined;

  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE_SCRIPT, 1, key, token).catch(() => undefined);
  }
}
