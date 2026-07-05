import { Router } from "express";
import { z } from "zod";
import { prisma } from "@jsp/db";
import { getQueueStats } from "@jsp/core";
import { asyncHandler } from "../middleware/async-handler";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { ApiError } from "../lib/errors";
import { requireProjectAccess, requireQueueAccess } from "../lib/access";
import { emitToProject } from "../lib/socket";

export const queuesRouter = Router();
queuesRouter.use(requireAuth);

const createQueueSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with dashes"),
  description: z.string().max(500).optional(),
  priority: z.number().int().min(0).max(100).default(0),
  concurrencyLimit: z.number().int().min(1).max(1000).default(5),
  rateLimitPerSecond: z.number().int().min(1).optional(),
  defaultRetryPolicyId: z.string().uuid().optional(),
});

const updateQueueSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  concurrencyLimit: z.number().int().min(1).max(1000).optional(),
  rateLimitPerSecond: z.number().int().min(1).nullable().optional(),
  defaultRetryPolicyId: z.string().uuid().nullable().optional(),
});

// Nested under /projects/:projectId/queues
queuesRouter.get(
  "/projects/:projectId/queues",
  asyncHandler(async (req, res) => {
    await requireProjectAccess(req.userId!, req.params.projectId, "VIEWER");
    const queues = await prisma.queue.findMany({
      where: { projectId: req.params.projectId },
      include: { defaultRetryPolicy: true, _count: { select: { jobs: true } } },
      orderBy: { priority: "desc" },
    });
    res.json({ data: queues });
  })
);

queuesRouter.post(
  "/projects/:projectId/queues",
  validate(createQueueSchema),
  asyncHandler(async (req, res) => {
    await requireProjectAccess(req.userId!, req.params.projectId, "ADMIN");
    const existing = await prisma.queue.findUnique({
      where: { projectId_slug: { projectId: req.params.projectId, slug: req.body.slug } },
    });
    if (existing) throw ApiError.conflict("A queue with this slug already exists in this project");

    const queue = await prisma.queue.create({ data: { projectId: req.params.projectId, ...req.body } });
    res.status(201).json(queue);
  })
);

// Flat /queues/:queueId routes
queuesRouter.get(
  "/queues/:queueId",
  asyncHandler(async (req, res) => {
    const { queue } = await requireQueueAccess(req.userId!, req.params.queueId, "VIEWER");
    res.json(queue);
  })
);

queuesRouter.patch(
  "/queues/:queueId",
  validate(updateQueueSchema),
  asyncHandler(async (req, res) => {
    await requireQueueAccess(req.userId!, req.params.queueId, "ADMIN");
    const updated = await prisma.queue.update({ where: { id: req.params.queueId }, data: req.body });
    emitToProject(updated.projectId, "queue.updated", updated);
    res.json(updated);
  })
);

queuesRouter.delete(
  "/queues/:queueId",
  asyncHandler(async (req, res) => {
    const { queue } = await requireQueueAccess(req.userId!, req.params.queueId, "OWNER");
    await prisma.queue.delete({ where: { id: queue.id } });
    res.status(204).send();
  })
);

queuesRouter.post(
  "/queues/:queueId/pause",
  asyncHandler(async (req, res) => {
    await requireQueueAccess(req.userId!, req.params.queueId, "MEMBER");
    const updated = await prisma.queue.update({ where: { id: req.params.queueId }, data: { isPaused: true } });
    emitToProject(updated.projectId, "queue.updated", updated);
    res.json(updated);
  })
);

queuesRouter.post(
  "/queues/:queueId/resume",
  asyncHandler(async (req, res) => {
    await requireQueueAccess(req.userId!, req.params.queueId, "MEMBER");
    const updated = await prisma.queue.update({ where: { id: req.params.queueId }, data: { isPaused: false } });
    emitToProject(updated.projectId, "queue.updated", updated);
    res.json(updated);
  })
);

queuesRouter.get(
  "/queues/:queueId/stats",
  asyncHandler(async (req, res) => {
    await requireQueueAccess(req.userId!, req.params.queueId, "VIEWER");
    res.json(await getQueueStats(prisma, req.params.queueId));
  })
);
