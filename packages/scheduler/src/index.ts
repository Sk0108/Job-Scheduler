import Redis from "ioredis";
import { prisma } from "@jsp/db";
import { sweepDueScheduledJobs, dispatchDueCronDefinitions, reapStaleClaims, withLock } from "@jsp/core";
import { config } from "./config";
import { logger } from "./logger";

const TICK_LOCK_KEY = "jsp:lock:scheduler-tick";

/** Starts the scheduler tick loop. Returns a shutdown function that stops the loop and closes
 * this module's own redis connection — it does not touch prisma, since that may be shared with
 * other in-process services (see @jsp/api's start-combined.ts). */
export function startScheduler(): () => Promise<void> {
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
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

  let loopDone: Promise<void> = Promise.resolve();
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
  loopDone = loop();

  return async function shutdown() {
    logger.info("scheduler shutting down");
    stopping = true;
    await loopDone;
    redis.disconnect();
  };
}

if (require.main === module) {
  const shutdown = startScheduler();
  function handleSignal(signal: string) {
    logger.info(`received ${signal}`);
    void shutdown()
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0));
  }
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
}
