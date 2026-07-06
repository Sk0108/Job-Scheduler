import Redis from "ioredis";
import { prisma } from "@jsp/db";
import { sweepDueScheduledJobs, dispatchDueCronDefinitions, reapStaleClaims, withLock } from "@jsp/core";
import { config } from "./config";
import { logger } from "./logger";

const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const TICK_LOCK_KEY = "jsp:lock:scheduler-tick";

let stopping = false;

async function tick() {
  // Mutual exclusion across scheduler replicas — see @jsp/core/src/lock.ts. The lock's TTL is
  // shorter than the tick interval so a crashed holder can never wedge future ticks.
  const ranAnything = await withLock(redis, TICK_LOCK_KEY, Math.max(1000, config.tickIntervalMs - 200), async () => {
    const [promoted, dispatched, reaped] = await Promise.all([
      sweepDueScheduledJobs(prisma),
      dispatchDueCronDefinitions(prisma, redis),
      reapStaleClaims(prisma, redis),
    ]);

    if (promoted || dispatched || reaped) {
      logger.info({ promoted, dispatched, reaped }, "scheduler tick");
    }
  });

  if (ranAnything === undefined) {
    logger.debug("skipped tick — another scheduler replica holds the lock");
  }
}

async function loop() {
  while (!stopping) {
    try {
      await tick();
    } catch (err) {
      logger.error({ err }, "scheduler tick failed");
    }
    await new Promise((resolve) => setTimeout(resolve, config.tickIntervalMs));
  }
}

logger.info({ tickIntervalMs: config.tickIntervalMs }, "scheduler starting");
loop();

async function shutdown(signal: string) {
  logger.info({ signal }, "scheduler shutting down");
  stopping = true;
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
