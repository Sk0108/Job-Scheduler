import { Router } from "express";
import { prisma } from "@jsp/db";
import { asyncHandler } from "../middleware/async-handler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";

export const workersRouter = Router();
workersRouter.use(requireAuth);

// Workers are a shared, system-wide fleet (not project-scoped in the schema — a single worker
// process can pull from queues across projects), so visibility here is any authenticated user,
// same as an internal ops dashboard. See docs/design-decisions.md.
const STALE_AFTER_MS = 20_000;

workersRouter.get(
  "/workers",
  asyncHandler(async (_req, res) => {
    const workers = await prisma.worker.findMany({ orderBy: { startedAt: "desc" } });
    res.json({
      data: workers.map((w) => ({
        ...w,
        isStale: w.status !== "OFFLINE" && Date.now() - w.lastHeartbeatAt.getTime() > STALE_AFTER_MS,
      })),
    });
  })
);

workersRouter.get(
  "/workers/:workerId",
  asyncHandler(async (req, res) => {
    const worker = await prisma.worker.findUnique({ where: { id: req.params.workerId } });
    if (!worker) throw ApiError.notFound("Worker not found");

    const [heartbeats, activeJobs] = await Promise.all([
      prisma.workerHeartbeat.findMany({ where: { workerId: worker.id }, orderBy: { timestamp: "desc" }, take: 50 }),
      prisma.job.findMany({ where: { claimedByWorkerId: worker.id, status: { in: ["CLAIMED", "RUNNING"] } } }),
    ]);

    res.json({
      ...worker,
      isStale: worker.status !== "OFFLINE" && Date.now() - worker.lastHeartbeatAt.getTime() > STALE_AFTER_MS,
      heartbeats,
      activeJobs,
    });
  })
);
