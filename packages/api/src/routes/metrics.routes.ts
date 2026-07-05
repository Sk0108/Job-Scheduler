import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@jsp/db";
import { getPriorityDistribution, getQueueStats, getSystemHealth } from "@jsp/core";
import { asyncHandler } from "../middleware/async-handler";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { requireProjectAccess } from "../lib/access";

export const metricsRouter = Router();
metricsRouter.use(requireAuth);

const throughputQuerySchema = z.object({
  projectId: z.string().uuid(),
  hours: z.string().optional(),
});

interface ThroughputBucket {
  bucket: Date;
  completed: bigint;
  failed: bigint;
}

metricsRouter.get(
  "/metrics/throughput",
  validate(throughputQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof throughputQuerySchema>;
    await requireProjectAccess(req.userId!, q.projectId, "VIEWER");
    const hours = Math.min(168, Math.max(1, parseInt(q.hours ?? "24", 10) || 24));

    const rows = await prisma.$queryRaw<ThroughputBucket[]>(Prisma.sql`
      SELECT
        date_trunc('hour', COALESCE(je.finished_at, je.started_at)) AS bucket,
        COUNT(*) FILTER (WHERE je.status = 'COMPLETED') AS completed,
        COUNT(*) FILTER (WHERE je.status IN ('FAILED', 'TIMED_OUT')) AS failed
      FROM job_executions je
      JOIN jobs j ON j.id = je.job_id
      JOIN queues q ON q.id = j.queue_id
      WHERE q.project_id = ${q.projectId}
        AND je.started_at >= now() - (${hours}::text || ' hours')::interval
      GROUP BY 1
      ORDER BY 1 ASC;
    `);

    res.json({
      hours,
      data: rows.map((r) => ({ bucket: r.bucket, completed: Number(r.completed), failed: Number(r.failed) })),
    });
  })
);

metricsRouter.get(
  "/metrics/health",
  validate(z.object({ projectId: z.string().uuid() }), "query"),
  asyncHandler(async (req, res) => {
    const { projectId } = req.query as unknown as { projectId: string };
    await requireProjectAccess(req.userId!, projectId, "VIEWER");
    res.json(await getSystemHealth(prisma, projectId));
  })
);

metricsRouter.get(
  "/metrics/priority-distribution",
  validate(z.object({ projectId: z.string().uuid() }), "query"),
  asyncHandler(async (req, res) => {
    const { projectId } = req.query as unknown as { projectId: string };
    await requireProjectAccess(req.userId!, projectId, "VIEWER");
    res.json({ data: await getPriorityDistribution(prisma, projectId) });
  })
);

metricsRouter.get(
  "/metrics/queues",
  validate(z.object({ projectId: z.string().uuid() }), "query"),
  asyncHandler(async (req, res) => {
    const { projectId } = req.query as unknown as { projectId: string };
    await requireProjectAccess(req.userId!, projectId, "VIEWER");
    const queues = await prisma.queue.findMany({ where: { projectId } });
    const stats = await Promise.all(queues.map((q) => getQueueStats(prisma, q.id)));
    res.json({ data: queues.map((q, i) => ({ queue: q, stats: stats[i] })) });
  })
);
