import os from "node:os";
import { prisma } from "@jsp/db";
import { publishEvent } from "@jsp/core";
import { config } from "./config";
import { logger } from "./logger";
import { redis } from "./redis";
import { Semaphore } from "./pool";
import { pollOnce } from "./poller";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const worker = await prisma.worker.create({
    data: {
      name: config.worker.name,
      hostname: os.hostname(),
      pid: process.pid,
      concurrency: config.worker.concurrency,
      queueFilter: config.worker.queueFilter,
      status: "ONLINE",
    },
  });

  logger.info({ workerId: worker.id, concurrency: config.worker.concurrency, queueFilter: config.worker.queueFilter }, "worker registered");
  await publishEvent(redis, { type: "worker.registered", workerId: worker.id, data: { name: worker.name, hostname: worker.hostname } });

  const semaphore = new Semaphore(config.worker.concurrency);
  let stopping = false;

  async function heartbeat() {
    const activeJobCount = semaphore.activeCount();
    const status = stopping ? "DRAINING" : activeJobCount >= config.worker.concurrency ? "BUSY" : "ONLINE";
    const memoryUsageMb = process.memoryUsage().rss / (1024 * 1024);
    const cpuLoad = os.loadavg()[0];

    await prisma.$transaction([
      prisma.worker.update({ where: { id: worker.id }, data: { status, activeJobCount, lastHeartbeatAt: new Date() } }),
      prisma.workerHeartbeat.create({ data: { workerId: worker.id, activeJobCount, cpuLoad, memoryUsageMb, status } }),
    ]);

    await publishEvent(redis, {
      type: "worker.heartbeat",
      workerId: worker.id,
      data: { status, activeJobCount, concurrency: config.worker.concurrency },
    });
  }

  const heartbeatTimer = setInterval(() => {
    heartbeat().catch((err) => logger.error({ err }, "heartbeat failed"));
  }, config.worker.heartbeatIntervalMs);

  let pollLoopDone: Promise<void> = Promise.resolve();
  async function pollLoop() {
    while (!stopping) {
      try {
        await pollOnce({
          prisma,
          redis,
          workerId: worker.id,
          semaphore,
          queueFilter: config.worker.queueFilter,
          lockDurationMs: config.worker.lockDurationMs,
        });
      } catch (err) {
        logger.error({ err }, "poll tick failed");
      }
      await sleep(config.worker.pollIntervalMs);
    }
  }
  pollLoopDone = pollLoop();

  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    logger.info({ signal, activeJobs: semaphore.activeCount() }, "graceful shutdown initiated — no longer claiming new jobs");

    await heartbeat().catch(() => undefined);
    await pollLoopDone;
    await semaphore.drain(config.worker.shutdownGraceMs);

    if (semaphore.activeCount() > 0) {
      logger.warn({ activeJobs: semaphore.activeCount() }, "shutdown grace period elapsed with jobs still running — exiting anyway");
    }

    clearInterval(heartbeatTimer);
    await prisma.worker.update({ where: { id: worker.id }, data: { status: "OFFLINE", stoppedAt: new Date(), activeJobCount: 0 } });
    await publishEvent(redis, { type: "worker.offline", workerId: worker.id });

    logger.info("worker shut down cleanly");
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "worker failed to start");
  process.exit(1);
});
