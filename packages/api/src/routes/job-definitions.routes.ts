import { Router } from "express";
import { z } from "zod";
import { prisma, RetryStrategy } from "@jsp/db";
import { getNextCronRun, isValidCronExpression } from "@jsp/shared";
import { asyncHandler } from "../middleware/async-handler";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { ApiError } from "../lib/errors";
import { requireQueueAccess } from "../lib/access";

export const jobDefinitionsRouter = Router();
jobDefinitionsRouter.use(requireAuth);

const createDefSchema = z
  .object({
    name: z.string().min(1).max(120),
    jobType: z.string().min(1).max(120),
    cronExpression: z.string().min(1),
    timezone: z.string().default("UTC"),
    payload: z.record(z.any()).default({}),
    priority: z.number().int().min(0).max(100).default(0),
    maxRetries: z.number().int().min(0).max(50).optional(),
    retryStrategy: z.nativeEnum(RetryStrategy).optional(),
    baseDelayMs: z.number().int().min(0).optional(),
    maxDelayMs: z.number().int().min(0).optional(),
    timeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
  })
  .refine((v) => isValidCronExpression(v.cronExpression), { message: "Invalid cron expression", path: ["cronExpression"] });

const updateDefSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  payload: z.record(z.any()).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  cronExpression: z.string().min(1).optional(),
  timezone: z.string().optional(),
  maxRetries: z.number().int().min(0).max(50).nullable().optional(),
  retryStrategy: z.nativeEnum(RetryStrategy).nullable().optional(),
  baseDelayMs: z.number().int().min(0).nullable().optional(),
  maxDelayMs: z.number().int().min(0).nullable().optional(),
  timeoutMs: z.number().int().min(1000).max(3_600_000).nullable().optional(),
});

jobDefinitionsRouter.get(
  "/queues/:queueId/job-definitions",
  asyncHandler(async (req, res) => {
    await requireQueueAccess(req.userId!, req.params.queueId, "VIEWER");
    const defs = await prisma.jobDefinition.findMany({ where: { queueId: req.params.queueId }, orderBy: { createdAt: "desc" } });
    res.json({ data: defs });
  })
);

jobDefinitionsRouter.post(
  "/queues/:queueId/job-definitions",
  validate(createDefSchema),
  asyncHandler(async (req, res) => {
    const { queue } = await requireQueueAccess(req.userId!, req.params.queueId, "MEMBER");
    const body = req.body as z.infer<typeof createDefSchema>;

    const def = await prisma.jobDefinition.create({
      data: {
        queueId: queue.id,
        name: body.name,
        jobType: body.jobType,
        cronExpression: body.cronExpression,
        timezone: body.timezone,
        payload: body.payload,
        priority: body.priority,
        maxRetries: body.maxRetries,
        retryStrategy: body.retryStrategy,
        baseDelayMs: body.baseDelayMs,
        maxDelayMs: body.maxDelayMs,
        timeoutMs: body.timeoutMs,
        nextRunAt: getNextCronRun(body.cronExpression, body.timezone),
      },
    });
    res.status(201).json(def);
  })
);

jobDefinitionsRouter.patch(
  "/job-definitions/:defId",
  validate(updateDefSchema),
  asyncHandler(async (req, res) => {
    const def = await prisma.jobDefinition.findUnique({ where: { id: req.params.defId } });
    if (!def) throw ApiError.notFound("Job definition not found");
    await requireQueueAccess(req.userId!, def.queueId, "MEMBER");

    const body = req.body as z.infer<typeof updateDefSchema>;
    if (body.cronExpression && !isValidCronExpression(body.cronExpression)) {
      throw ApiError.badRequest("Invalid cron expression");
    }

    const updated = await prisma.jobDefinition.update({
      where: { id: def.id },
      data: {
        ...body,
        nextRunAt:
          body.cronExpression || body.timezone
            ? getNextCronRun(body.cronExpression ?? def.cronExpression, body.timezone ?? def.timezone)
            : undefined,
      },
    });
    res.json(updated);
  })
);

jobDefinitionsRouter.delete(
  "/job-definitions/:defId",
  asyncHandler(async (req, res) => {
    const def = await prisma.jobDefinition.findUnique({ where: { id: req.params.defId } });
    if (!def) throw ApiError.notFound("Job definition not found");
    await requireQueueAccess(req.userId!, def.queueId, "ADMIN");
    await prisma.jobDefinition.delete({ where: { id: def.id } });
    res.status(204).send();
  })
);

jobDefinitionsRouter.post(
  "/job-definitions/:defId/pause",
  asyncHandler(async (req, res) => {
    const def = await prisma.jobDefinition.findUnique({ where: { id: req.params.defId } });
    if (!def) throw ApiError.notFound("Job definition not found");
    await requireQueueAccess(req.userId!, def.queueId, "MEMBER");
    res.json(await prisma.jobDefinition.update({ where: { id: def.id }, data: { isPaused: true } }));
  })
);

jobDefinitionsRouter.post(
  "/job-definitions/:defId/resume",
  asyncHandler(async (req, res) => {
    const def = await prisma.jobDefinition.findUnique({ where: { id: req.params.defId } });
    if (!def) throw ApiError.notFound("Job definition not found");
    await requireQueueAccess(req.userId!, def.queueId, "MEMBER");
    res.json(
      await prisma.jobDefinition.update({
        where: { id: def.id },
        data: { isPaused: false, nextRunAt: getNextCronRun(def.cronExpression, def.timezone) },
      })
    );
  })
);
