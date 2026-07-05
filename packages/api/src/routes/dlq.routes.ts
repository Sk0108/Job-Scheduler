import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@jsp/db";
import { requeueJob } from "@jsp/core";
import { parsePagination, toPaginatedResult } from "@jsp/shared";
import { asyncHandler } from "../middleware/async-handler";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { ApiError } from "../lib/errors";
import { requireProjectAccess } from "../lib/access";
import { emitToProject } from "../lib/socket";

export const dlqRouter = Router();
dlqRouter.use(requireAuth);

const listQuerySchema = z.object({
  projectId: z.string().uuid(),
  queueId: z.string().uuid().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

dlqRouter.get(
  "/dlq",
  validate(listQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listQuerySchema>;
    await requireProjectAccess(req.userId!, q.projectId, "VIEWER");
    const pagination = parsePagination(req.query as Record<string, unknown>);

    const where: Prisma.DeadLetterEntryWhereInput = {
      resolvedAt: null,
      job: { queue: { projectId: q.projectId } },
      ...(q.queueId ? { queueId: q.queueId } : {}),
    };

    const [data, total] = await Promise.all([
      prisma.deadLetterEntry.findMany({
        where,
        orderBy: { movedAt: "desc" },
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        include: { job: { select: { id: true, type: true, attempt: true, queueId: true } } },
      }),
      prisma.deadLetterEntry.count({ where }),
    ]);

    res.json(toPaginatedResult(data, total, pagination));
  })
);

dlqRouter.post(
  "/dlq/:entryId/retry",
  asyncHandler(async (req, res) => {
    const entry = await prisma.deadLetterEntry.findUnique({ where: { id: req.params.entryId }, include: { job: { include: { queue: true } } } });
    if (!entry) throw ApiError.notFound("Dead letter entry not found");
    await requireProjectAccess(req.userId!, entry.job.queue.projectId, "MEMBER");

    const job = await requeueJob(prisma, entry.jobId);
    emitToProject(entry.job.queue.projectId, "job.queued", job);
    res.json(job);
  })
);

dlqRouter.post(
  "/dlq/:entryId/resolve",
  asyncHandler(async (req, res) => {
    const entry = await prisma.deadLetterEntry.findUnique({ where: { id: req.params.entryId }, include: { job: { include: { queue: true } } } });
    if (!entry) throw ApiError.notFound("Dead letter entry not found");
    await requireProjectAccess(req.userId!, entry.job.queue.projectId, "MEMBER");

    const updated = await prisma.deadLetterEntry.update({
      where: { id: entry.id },
      data: { resolvedAt: new Date(), resolution: "manually_resolved" },
    });
    res.json(updated);
  })
);
