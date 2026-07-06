import { prisma } from "@jsp/db";
import { startWorker } from "@jsp/worker";
import { startScheduler } from "@jsp/scheduler";
import { startApi } from "./index";
import { logger } from "./logger";

/**
 * Production entrypoint for free-tier hosts (e.g. Render's free web service) that only give you
 * one always-on process. Runs the api, worker, and scheduler together instead of as three
 * separate services. For local dev, keep using `dev:api` / `dev:worker` / `dev:scheduler`.
 */
async function main() {
  const shutdownApi = startApi();
  const shutdownWorker = await startWorker();
  const shutdownScheduler = startScheduler();

  let shuttingDown = false;
  function handleSignal(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down combined process`);
    setTimeout(() => process.exit(1), 15_000).unref();

    void Promise.allSettled([shutdownApi(), shutdownWorker(), shutdownScheduler()])
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0));
  }

  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "combined process failed to start");
  process.exit(1);
});
