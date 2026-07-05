import path from "node:path";
import os from "node:os";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

export const config = {
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  logLevel: process.env.LOG_LEVEL ?? "info",
  worker: {
    name: process.env.WORKER_NAME ?? `${os.hostname()}-${process.pid}`,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "5", 10),
    pollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? "750", 10),
    heartbeatIntervalMs: parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? "5000", 10),
    // lockDuration is how long a claim is held before the reaper considers it abandoned;
    // must comfortably exceed heartbeatIntervalMs so a couple of missed beats don't
    // trigger a false-positive reclaim of a job that's still actively running.
    lockDurationMs: parseInt(process.env.WORKER_LOCK_DURATION_MS ?? "30000", 10),
    // "*" polls every unpaused queue; otherwise a comma-separated list of queue slugs.
    queueFilter: process.env.WORKER_QUEUES ?? "*",
    shutdownGraceMs: parseInt(process.env.WORKER_SHUTDOWN_GRACE_MS ?? "20000", 10),
  },
};
