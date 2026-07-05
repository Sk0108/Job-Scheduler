import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, RetryStrategy } from "@jsp/db";
import { cancelJob, requeueJob } from "@jsp/core";
import { parsePagination, toPaginatedResult, summarizeFailure } from "@jsp/shared";
import { asyncHandler } from "../middleware/async-handler";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { jobCreationRateLimit } from "../middleware/rate-limit";
import { ApiError } from "../lib/errors";
import { requireProjectAccess, requireQueueAccess, requireJobAccess } from "../lib/access";
import { emitToProject } from "../lib/socket";

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

const createJobSchema = z.object({
  type: z.string().min(1).max(120),
  payload: z.record(z.any()).default({}),
  priority: z.number().int().min(0).max(100).default(0),
  runAt: z.string().datetime().optional(),
  idempotencyKey: z.string().max(200).optional(),
  maxRetries: z.number().int().min(0).max(50).optional(),
  retryStrategy: z.nativeEnum(RetryStrategy).optional(),
  baseDelayMs: z.number().int().min(0).optional(),
  maxDelayMs: z.number().int().min(0).optional(),
  timeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
  dependsOn: z.array(z.string().uuid()).max(50).optional(),
});

const createBatchSchema = z.object({
  name: z.string().min(1).max(160),
  jobs: z
    .array(
      z.object({
        type: z.string().min(1).max(120),
        payload: z.record(z.any()).default({}),
        priority: z.number().int().min(0).max(100).default(0),
      })
    )
    .min(1)
    .max(5000),
});

const listJobsQuerySchema = z.object({
  projectId: z.string().uuid(),
  queueId: z.string().uuid().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  search: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

const calendarQuerySchema = z.object({
  projectId: z.string().uuid(),
  from: z.string().datetime(),
  to: z.string().datetime(),
});

const moveJobSchema = z.object({
  queueId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

jobsRouter.post(
  "/queues/:queueId/jobs",
  jobCreationRateLimit,
  validate(createJobSchema),
  asyncHandler(async (req, res) => {
    const { queue } = await requireQueueAccess(req.userId!, req.params.queueId, "MEMBER");
    const body = req.body as z.infer<typeof createJobSchema>;

    const runAt = body.runAt ? new Date(body.runAt) : new Date();
    const hasDeps = !!body.dependsOn?.length;
    const status = hasDeps || runAt.getTime() > Date.now() ? "SCHEDULED" : "QUEUED";

    if (hasDeps) {
      const count = await prisma.job.count({ where: { id: { in: body.dependsOn }, queue: { projectId: queue.projectId } } });
      if (count !== body.dependsOn!.length) {
        throw ApiError.badRequest("One or more dependsOn job ids were not found in this project");
      }
    }

    try {
      const job = await prisma.job.create({
        data: {
          queueId: queue.id,
          type: body.type,
          payload: body.payload,
          priority: body.priority,
          status,
          runAt,
          idempotencyKey: body.idempotencyKey,
          maxRetries: body.maxRetries,
          retryStrategy: body.retryStrategy,
          baseDelayMs: body.baseDelayMs,
          maxDelayMs: body.maxDelayMs,
          timeoutMs: body.timeoutMs,
          createdById: req.userId,
          dependsOn: hasDeps ? { create: body.dependsOn!.map((id) => ({ dependsOnJobId: id })) } : undefined,
        },
      });

      emitToProject(queue.projectId, "job.queued", job);
      res.status(201).json(job);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && body.idempotencyKey) {
        const existing = await prisma.job.findUnique({
          where: { queueId_idempotencyKey: { queueId: queue.id, idempotencyKey: body.idempotencyKey } },
        });
        if (existing) return res.status(200).json({ ...existing, deduplicated: true });
      }
      throw err;
    }
  })
);

jobsRouter.post(
  "/queues/:queueId/batches",
  jobCreationRateLimit,
  validate(createBatchSchema),
  asyncHandler(async (req, res) => {
    const { queue } = await requireQueueAccess(req.userId!, req.params.queueId, "MEMBER");
    const body = req.body as z.infer<typeof createBatchSchema>;

    const batch = await prisma.batch.create({
      data: { projectId: queue.projectId, queueId: queue.id, name: body.name, totalJobs: body.jobs.length },
    });

    await prisma.job.createMany({
      data: body.jobs.map((j) => ({
        queueId: queue.id,
        batchId: batch.id,
        type: j.type,
        payload: j.payload,
        priority: j.priority,
        status: "QUEUED" as const,
        createdById: req.userId,
      })),
    });

    emitToProject(queue.projectId, "job.queued", { batchId: batch.id, count: body.jobs.length, source: "batch" });
    res.status(201).json(batch);
  })
);

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

jobsRouter.get(
  "/jobs",
  validate(listJobsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listJobsQuerySchema>;
    await requireProjectAccess(req.userId!, q.projectId, "VIEWER");
    const pagination = parsePagination(req.query as Record<string, unknown>);

    const where: Prisma.JobWhereInput = { queue: { projectId: q.projectId } };
    if (q.queueId) where.queueId = q.queueId;
    if (q.status) where.status = { in: q.status.split(",").map((s) => s.trim().toUpperCase()) as never };
    if (q.type) where.type = q.type;
    if (q.search) {
      where.OR = [{ id: q.search }, { type: { contains: q.search, mode: "insensitive" } }];
    }

    const [data, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        include: { queue: { select: { id: true, name: true, slug: true } } },
      }),
      prisma.job.count({ where }),
    ]);

    res.json(toPaginatedResult(data, total, pagination));
  })
);

// Registered before "/jobs/:jobId" so Express doesn't match "calendar" as a jobId param.
jobsRouter.get(
  "/jobs/calendar",
  validate(calendarQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof calendarQuerySchema>;
    await requireProjectAccess(req.userId!, q.projectId, "VIEWER");

    const jobs = await prisma.job.findMany({
      where: {
        queue: { projectId: q.projectId },
        runAt: { gte: new Date(q.from), lte: new Date(q.to) },
      },
      select: {
        id: true,
        type: true,
        status: true,
        priority: true,
        runAt: true,
        queueId: true,
        queue: { select: { name: true, slug: true } },
      },
      orderBy: { runAt: "asc" },
      take: 2000,
    });

    res.json({ data: jobs });
  })
);

jobsRouter.get(
  "/jobs/:jobId",
  asyncHandler(async (req, res) => {
    const { job } = await requireJobAccess(req.userId!, req.params.jobId, "VIEWER");
    const full = await prisma.job.findUniqueOrThrow({
      where: { id: job.id },
      include: {
        queue: true,
        batch: true,
        jobDefinition: true,
        executions: { orderBy: { attemptNumber: "desc" }, include: { worker: { select: { id: true, name: true, hostname: true } } } },
        deadLetter: { orderBy: { movedAt: "desc" } },
        dependsOn: { include: { dependsOnJob: { select: { id: true, type: true, status: true } } } },
        dependents: { include: { job: { select: { id: true, type: true, status: true } } } },
      },
    });

    let failureSummary = null;
    if (["FAILED", "DEAD_LETTER"].includes(full.status) && full.executions.length) {
      const latest = full.executions[0];
      failureSummary = summarizeFailure({
        jobType: full.type,
        attempt: full.attempt,
        maxRetries: full.maxRetries ?? 5,
        errorMessage: latest.errorMessage,
        errorStack: latest.errorStack,
        recentErrorMessages: full.executions.map((e) => e.errorMessage).filter((m): m is string => !!m),
      });
    }

    res.json({ ...full, failureSummary });
  })
);

jobsRouter.get(
  "/jobs/:jobId/logs",
  asyncHandler(async (req, res) => {
    const { job } = await requireJobAccess(req.userId!, req.params.jobId, "VIEWER");
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const [data, total] = await Promise.all([
      prisma.jobLog.findMany({
        where: { jobId: job.id },
        orderBy: { timestamp: "desc" },
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      prisma.jobLog.count({ where: { jobId: job.id } }),
    ]);
    res.json(toPaginatedResult(data, total, pagination));
  })
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

jobsRouter.post(
  "/jobs/:jobId/cancel",
  asyncHandler(async (req, res) => {
    const { job } = await requireJobAccess(req.userId!, req.params.jobId, "MEMBER");
    const result = await cancelJob(prisma, job.id);
    if (result.count === 0) throw ApiError.conflict(`Job cannot be cancelled from status ${job.status}`);
    emitToProject(job.queue.projectId, "job.cancelled", { jobId: job.id });
    res.json({ cancelled: true });
  })
);

jobsRouter.post(
  "/jobs/:jobId/retry",
  asyncHandler(async (req, res) => {
    const { job } = await requireJobAccess(req.userId!, req.params.jobId, "MEMBER");
    const updated = await requeueJob(prisma, job.id);
    emitToProject(job.queue.projectId, "job.queued", updated);
    res.json(updated);
  })
);

// Powers the drag-and-drop board view: moves a not-yet-running job to a different queue in the
// same project. Jobs actively CLAIMED/RUNNING can't be moved out from under the worker executing them.
jobsRouter.post(
  "/jobs/:jobId/move",
  validate(moveJobSchema),
  asyncHandler(async (req, res) => {
    const { job } = await requireJobAccess(req.userId!, req.params.jobId, "MEMBER");
    if (!["QUEUED", "SCHEDULED", "FAILED", "DEAD_LETTER", "CANCELLED"].includes(job.status)) {
      throw ApiError.conflict(`Cannot move a job that is currently ${job.status}`);
    }

    const targetQueue = await prisma.queue.findUnique({ where: { id: req.body.queueId } });
    if (!targetQueue) throw ApiError.notFound("Target queue not found");
    if (targetQueue.projectId !== job.queue.projectId) {
      throw ApiError.badRequest("Cannot move a job to a queue in a different project");
    }

    const updated = await prisma.job.update({ where: { id: job.id }, data: { queueId: targetQueue.id } });
    emitToProject(targetQueue.projectId, "queue.updated", { jobMoved: true, jobId: job.id, fromQueueId: job.queueId, toQueueId: targetQueue.id });
    res.json(updated);
  })
);
