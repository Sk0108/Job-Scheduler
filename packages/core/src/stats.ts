import { PrismaClient } from "@jsp/db";

export interface DurationBucket {
  label: string;
  count: number;
}

export interface QueueStats {
  queueId: string;
  counts: Record<string, number>;
  activeCount: number;
  throughputLastHour: number;
  avgDurationMsLast100: number | null;
  failureRateLast100: number;
  durationHistogram: DurationBucket[];
}

const STATUSES = ["SCHEDULED", "QUEUED", "CLAIMED", "RUNNING", "COMPLETED", "FAILED", "DEAD_LETTER", "CANCELLED"] as const;

const DURATION_BUCKETS = [
  { max: 100, label: "0-100ms" },
  { max: 250, label: "100-250ms" },
  { max: 500, label: "250-500ms" },
  { max: 1000, label: "500ms-1s" },
  { max: 2500, label: "1-2.5s" },
  { max: 5000, label: "2.5-5s" },
  { max: Infinity, label: "5s+" },
];

function bucketDurations(durations: number[]): DurationBucket[] {
  const buckets = DURATION_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const d of durations) {
    const idx = DURATION_BUCKETS.findIndex((b) => d <= b.max);
    buckets[idx === -1 ? buckets.length - 1 : idx].count++;
  }
  return buckets;
}

export async function getQueueStats(prisma: PrismaClient, queueId: string): Promise<QueueStats> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [grouped, throughputLastHour, recentExecutions] = await Promise.all([
    prisma.job.groupBy({ by: ["status"], where: { queueId }, _count: { _all: true } }),
    prisma.job.count({ where: { queueId, status: "COMPLETED", completedAt: { gte: oneHourAgo } } }),
    prisma.jobExecution.findMany({
      where: { job: { queueId }, status: { in: ["COMPLETED", "FAILED", "TIMED_OUT"] } },
      orderBy: { startedAt: "desc" },
      take: 100,
      select: { status: true, durationMs: true },
    }),
  ]);

  const counts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of grouped) counts[row.status] = row._count._all;

  const durations = recentExecutions.map((e) => e.durationMs).filter((d): d is number => d != null);
  const avgDurationMsLast100 = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  const failures = recentExecutions.filter((e) => e.status !== "COMPLETED").length;
  const failureRateLast100 = recentExecutions.length ? failures / recentExecutions.length : 0;

  return {
    queueId,
    counts,
    activeCount: counts.CLAIMED + counts.RUNNING,
    throughputLastHour,
    avgDurationMsLast100,
    failureRateLast100,
    durationHistogram: bucketDurations(durations),
  };
}

export interface PriorityBand {
  band: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  count: number;
}

/** Buckets every non-terminal job in a project into the same 4 quartile bands the dashboard renders with. */
export async function getPriorityDistribution(prisma: PrismaClient, projectId: string): Promise<PriorityBand[]> {
  const queueIds = (await prisma.queue.findMany({ where: { projectId }, select: { id: true } })).map((q) => q.id);
  const jobs = await prisma.job.findMany({
    where: { queueId: { in: queueIds }, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    select: { priority: true },
  });

  const bands: Record<PriorityBand["band"], number> = { LOW: 0, NORMAL: 0, HIGH: 0, CRITICAL: 0 };
  for (const { priority } of jobs) {
    if (priority < 25) bands.LOW++;
    else if (priority < 50) bands.NORMAL++;
    else if (priority < 75) bands.HIGH++;
    else bands.CRITICAL++;
  }

  return (Object.keys(bands) as PriorityBand["band"][]).map((band) => ({ band, count: bands[band] }));
}

export interface SystemHealth {
  totalJobs: number;
  queued: number;
  scheduled: number;
  running: number;
  deadLetter: number;
  workersOnline: number;
  workersTotal: number;
  throughputLastHour: number;
  failedLastHour: number;
}

export async function getSystemHealth(prisma: PrismaClient, projectId: string): Promise<SystemHealth> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const queueIds = (await prisma.queue.findMany({ where: { projectId }, select: { id: true } })).map((q) => q.id);

  const [byStatus, workersOnline, workersTotal, throughputLastHour, failedLastHour] = await Promise.all([
    prisma.job.groupBy({ by: ["status"], where: { queueId: { in: queueIds } }, _count: { _all: true } }),
    prisma.worker.count({ where: { status: { in: ["ONLINE", "BUSY"] } } }),
    prisma.worker.count(),
    prisma.job.count({ where: { queueId: { in: queueIds }, status: "COMPLETED", completedAt: { gte: oneHourAgo } } }),
    prisma.job.count({ where: { queueId: { in: queueIds }, status: { in: ["FAILED", "DEAD_LETTER"] }, failedAt: { gte: oneHourAgo } } }),
  ]);

  const map = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
  return {
    totalJobs: byStatus.reduce((a, r) => a + r._count._all, 0),
    queued: map.QUEUED ?? 0,
    scheduled: map.SCHEDULED ?? 0,
    running: (map.RUNNING ?? 0) + (map.CLAIMED ?? 0),
    deadLetter: map.DEAD_LETTER ?? 0,
    workersOnline,
    workersTotal,
    throughputLastHour,
    failedLastHour,
  };
}
