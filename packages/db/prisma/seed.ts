import { PrismaClient, RetryStrategy, JobStatus, ExecutionStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Historical data generation — gives the dashboard's charts (throughput,
// priority mix, queue comparison, duration histogram) real variety instead of
// a handful of jobs clustered around "now". These rows are created directly
// as terminal (COMPLETED/FAILED/DEAD_LETTER), so the live worker never
// touches them regardless of job "type" — the type names below don't need
// registered handlers.
// ---------------------------------------------------------------------------

const HISTORICAL_JOB_TYPES: Record<string, string[]> = {
  emails: ["send-welcome-email", "send-followup-email", "send-newsletter", "send-password-reset", "send-invoice-email"],
  reports: ["generate-monthly-report", "rollup-usage-stats", "export-csv-report", "generate-invoice-pdf"],
  "flaky-webhooks": ["call-unreliable-webhook", "sync-partner-api", "post-analytics-event"],
  notifications: ["send-push-notification", "send-sms-alert", "post-slack-message"],
};

// Job types with a real handler registered in @jsp/worker — safe to use for jobs that might
// actually still be live (QUEUED/SCHEDULED) since a worker could genuinely execute them.
const REAL_HANDLER_TYPES = ["send-welcome-email", "send-followup-email", "send-newsletter", "generate-monthly-report", "rollup-usage-stats"];

const ERROR_MESSAGES = [
  "Error: operation timed out after 30000ms",
  "ECONNREFUSED: connection refused by upstream host",
  "Bad Gateway: upstream service returned 502 Bad Gateway",
  "Service Unavailable: upstream returned 503",
  "401 Unauthorized: invalid api key",
  "403 Forbidden: insufficient permissions for this resource",
  "ValidationError: payload failed schema validation (missing field 'email')",
  "JavaScript heap out of memory",
];

/** Weighted so most jobs are everyday priority and only a few are critical — mirrors a real system. */
function weightedPriority(): number {
  const r = Math.random();
  if (r < 0.45) return Math.floor(Math.random() * 25); // LOW
  if (r < 0.75) return 25 + Math.floor(Math.random() * 25); // NORMAL
  if (r < 0.92) return 50 + Math.floor(Math.random() * 25); // HIGH
  return 75 + Math.floor(Math.random() * 26); // CRITICAL
}

/** Spread across every duration histogram bucket (0-100ms through 5s+), not just one or two. */
function randomDuration(): number {
  const buckets = [70, 180, 350, 700, 1500, 3200, 6000];
  const base = buckets[Math.floor(Math.random() * buckets.length)];
  return Math.round(base * (0.6 + Math.random() * 0.7));
}

/** Business-hours bias so the 24h throughput chart reads as a real daily cycle, not flat noise. */
function volumeForHour(hourOfDay: number): number {
  const businessHours = hourOfDay >= 8 && hourOfDay <= 20;
  return businessHours ? 2 + Math.floor(Math.random() * 5) : Math.floor(Math.random() * 2);
}

async function createManyChunked<T>(model: { createMany: (args: { data: T[] }) => Promise<unknown> }, rows: T[], chunkSize = 500) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await model.createMany({ data: rows.slice(i, i + chunkSize) });
  }
}

async function generateHistory(queues: { id: string; slug: string }[], ownerId: string, hoursBack: number) {
  const jobRows: Prisma.JobCreateManyInput[] = [];
  const executionRows: Prisma.JobExecutionCreateManyInput[] = [];
  const dlqRows: Prisma.DeadLetterEntryCreateManyInput[] = [];
  const now = Date.now();

  for (const queue of queues) {
    const types = HISTORICAL_JOB_TYPES[queue.slug] ?? ["generic-task"];
    const failureChance = queue.slug === "flaky-webhooks" ? 0.35 : 0.08;

    for (let hoursAgo = hoursBack - 1; hoursAgo >= 0; hoursAgo--) {
      const bucketStart = now - hoursAgo * 60 * 60 * 1000;
      const hourOfDay = new Date(bucketStart).getHours();
      const count = volumeForHour(hourOfDay);

      for (let i = 0; i < count; i++) {
        const jobId = randomUUID();
        const type = types[Math.floor(Math.random() * types.length)];
        const firstStartedAt = new Date(bucketStart + Math.floor(Math.random() * 55 * 60 * 1000));
        const priority = weightedPriority();

        // A job only ever comes to rest as COMPLETED or DEAD_LETTER — FAILED is transient in the
        // real system (immediately followed by a scheduled retry), so historical data should never
        // model a job as permanently "FAILED"; that would be a state the live system can't produce.
        const roll = Math.random();
        const isDeadLetter = roll < failureChance * 0.4;
        const retriedThenSucceeded = !isDeadLetter && roll < failureChance;
        const finalStatus: JobStatus = isDeadLetter ? "DEAD_LETTER" : "COMPLETED";
        const totalAttempts = isDeadLetter ? 3 + Math.floor(Math.random() * 3) : retriedThenSucceeded ? 2 : 1;

        let cursor = firstStartedAt;
        let lastFinishedAt = firstStartedAt;
        let lastErrorMessage: string | null = null;

        for (let attemptNumber = 1; attemptNumber <= totalAttempts; attemptNumber++) {
          const isLastAttempt = attemptNumber === totalAttempts;
          const attemptSucceeds = isLastAttempt && !isDeadLetter;
          const durationMs = randomDuration();
          const startedAt = cursor;
          const finishedAt = new Date(startedAt.getTime() + durationMs);
          const errorMessage = attemptSucceeds ? null : ERROR_MESSAGES[Math.floor(Math.random() * ERROR_MESSAGES.length)];

          executionRows.push({
            id: randomUUID(),
            jobId,
            attemptNumber,
            status: (attemptSucceeds ? "COMPLETED" : "FAILED") as ExecutionStatus,
            startedAt,
            finishedAt,
            durationMs,
            errorMessage,
            createdAt: startedAt,
          });

          lastFinishedAt = finishedAt;
          lastErrorMessage = errorMessage;
          // Next attempt (if any) follows a short backoff gap, same as the real retry delay.
          cursor = new Date(finishedAt.getTime() + 30_000 + Math.floor(Math.random() * 4 * 60 * 1000));
        }

        jobRows.push({
          id: jobId,
          queueId: queue.id,
          type,
          payload: {},
          priority,
          status: finalStatus,
          runAt: firstStartedAt,
          attempt: totalAttempts,
          startedAt: firstStartedAt,
          completedAt: finalStatus === "COMPLETED" ? lastFinishedAt : null,
          failedAt: finalStatus === "DEAD_LETTER" ? lastFinishedAt : null,
          lastError: lastErrorMessage,
          createdById: ownerId,
          createdAt: firstStartedAt,
          updatedAt: lastFinishedAt,
        });

        if (finalStatus === "DEAD_LETTER") {
          dlqRows.push({
            id: randomUUID(),
            jobId,
            queueId: queue.id,
            reason: "max_retries_exhausted",
            lastError: lastErrorMessage,
            attemptsMade: totalAttempts,
            payloadSnapshot: {},
            movedAt: lastFinishedAt,
          });
        }
      }
    }
  }

  await createManyChunked(prisma.job, jobRows);
  await createManyChunked(prisma.jobExecution, executionRows);
  if (dlqRows.length) await createManyChunked(prisma.deadLetterEntry, dlqRows);

  return { jobs: jobRows.length, executions: executionRows.length, deadLettered: dlqRows.length };
}

/** Jobs scheduled over the next two weeks so the Calendar view has something to show going forward. */
async function generateFutureSchedule(queues: { id: string }[], ownerId: string, days: number) {
  const rows: Prisma.JobCreateManyInput[] = [];
  const now = Date.now();

  for (let day = 1; day <= days; day++) {
    const perDay = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < perDay; i++) {
      const queue = queues[Math.floor(Math.random() * queues.length)];
      const type = REAL_HANDLER_TYPES[Math.floor(Math.random() * REAL_HANDLER_TYPES.length)];
      const runAt = new Date(now + day * 24 * 60 * 60 * 1000 + Math.floor(Math.random() * 20 * 60 * 60 * 1000));
      rows.push({
        id: randomUUID(),
        queueId: queue.id,
        type,
        payload: {},
        priority: weightedPriority(),
        status: "SCHEDULED",
        runAt,
        createdById: ownerId,
      });
    }
  }

  await createManyChunked(prisma.job, rows);
  return rows.length;
}

async function generateCancelled(queues: { id: string }[], ownerId: string, count: number) {
  const rows: Prisma.JobCreateManyInput[] = Array.from({ length: count }).map(() => {
    const queue = queues[Math.floor(Math.random() * queues.length)];
    return {
      id: randomUUID(),
      queueId: queue.id,
      type: REAL_HANDLER_TYPES[Math.floor(Math.random() * REAL_HANDLER_TYPES.length)],
      payload: {},
      priority: weightedPriority(),
      status: "CANCELLED" as JobStatus,
      createdById: ownerId,
    };
  });
  await createManyChunked(prisma.job, rows);
  return rows.length;
}

async function main() {
  const passwordHash = await bcrypt.hash("Password123!", 10);

  const owner = await prisma.user.upsert({
    where: { email: "admin@demo.io" },
    update: {},
    create: { email: "admin@demo.io", passwordHash, name: "Ada Owner" },
  });

  const member = await prisma.user.upsert({
    where: { email: "member@demo.io" },
    update: {},
    create: { email: "member@demo.io", passwordHash, name: "Mo Member" },
  });

  const org = await prisma.organization.upsert({
    where: { slug: "demo-corp" },
    update: {},
    create: { name: "Demo Corp", slug: "demo-corp" },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: owner.id } },
    update: { role: "OWNER" },
    create: { organizationId: org.id, userId: owner.id, role: "OWNER" },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: member.id } },
    update: { role: "MEMBER" },
    create: { organizationId: org.id, userId: member.id, role: "MEMBER" },
  });

  const project = await prisma.project.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: "core-platform" } },
    update: {},
    create: {
      organizationId: org.id,
      slug: "core-platform",
      name: "Core Platform",
      description: "Primary product backend jobs",
    },
  });

  const retryPolicy = await prisma.retryPolicy.upsert({
    where: { projectId_name: { projectId: project.id, name: "default-exponential" } },
    update: {},
    create: {
      projectId: project.id,
      name: "default-exponential",
      strategy: RetryStrategy.EXPONENTIAL,
      maxRetries: 5,
      baseDelayMs: 2000,
      maxDelayMs: 120000,
      jitter: true,
    },
  });

  const quickRetryPolicy = await prisma.retryPolicy.upsert({
    where: { projectId_name: { projectId: project.id, name: "fixed-quick" } },
    update: {},
    create: {
      projectId: project.id,
      name: "fixed-quick",
      strategy: RetryStrategy.FIXED,
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      jitter: false,
    },
  });

  const emailQueue = await prisma.queue.upsert({
    where: { projectId_slug: { projectId: project.id, slug: "emails" } },
    update: {},
    create: {
      projectId: project.id,
      slug: "emails",
      name: "Emails",
      description: "Transactional email delivery",
      priority: 5,
      concurrencyLimit: 10,
      rateLimitPerSecond: 20,
      defaultRetryPolicyId: retryPolicy.id,
    },
  });

  const reportsQueue = await prisma.queue.upsert({
    where: { projectId_slug: { projectId: project.id, slug: "reports" } },
    update: {},
    create: {
      projectId: project.id,
      slug: "reports",
      name: "Reports",
      description: "Heavy analytical report generation",
      priority: 1,
      concurrencyLimit: 2,
      defaultRetryPolicyId: retryPolicy.id,
    },
  });

  const flakyQueue = await prisma.queue.upsert({
    where: { projectId_slug: { projectId: project.id, slug: "flaky-webhooks" } },
    update: {},
    create: {
      projectId: project.id,
      slug: "flaky-webhooks",
      name: "Flaky Webhooks",
      description: "Demonstrates retries + DLQ (handler fails intentionally)",
      priority: 3,
      concurrencyLimit: 5,
      defaultRetryPolicyId: retryPolicy.id,
    },
  });

  const notificationsQueue = await prisma.queue.upsert({
    where: { projectId_slug: { projectId: project.id, slug: "notifications" } },
    update: {},
    create: {
      projectId: project.id,
      slug: "notifications",
      name: "Notifications",
      description: "Push, SMS, and chat notifications",
      priority: 4,
      concurrencyLimit: 8,
      rateLimitPerSecond: 15,
      defaultRetryPolicyId: quickRetryPolicy.id,
    },
  });

  const allQueues = [emailQueue, reportsQueue, flakyQueue, notificationsQueue];

  // Wipe previously-seeded jobs/executions/definitions/batches so re-running `db:seed` is
  // idempotent and always produces a clean, consistent dataset (cascades to executions/logs/DLQ).
  await prisma.job.deleteMany({ where: { queue: { projectId: project.id } } });
  await prisma.jobDefinition.deleteMany({ where: { queue: { projectId: project.id } } });
  await prisma.batch.deleteMany({ where: { projectId: project.id } });

  // --- Live, hand-authored scenarios (demonstrate specific lifecycle features) ---

  await prisma.job.create({
    data: {
      queueId: emailQueue.id,
      type: "send-welcome-email",
      payload: { to: "new-user@example.com", template: "welcome" },
      status: "QUEUED",
      priority: 40,
      createdById: owner.id,
    },
  });

  await prisma.job.create({
    data: {
      queueId: emailQueue.id,
      type: "send-followup-email",
      payload: { to: "new-user@example.com", template: "followup" },
      status: "SCHEDULED",
      priority: 20,
      runAt: new Date(Date.now() + 2 * 60 * 1000),
      createdById: owner.id,
    },
  });

  await prisma.job.create({
    data: {
      queueId: reportsQueue.id,
      type: "generate-monthly-report",
      payload: { month: "2026-07" },
      status: "SCHEDULED",
      priority: 60,
      runAt: new Date(Date.now() + 5 * 60 * 1000),
      timeoutMs: 60000,
      createdById: owner.id,
    },
  });

  await prisma.jobDefinition.create({
    data: {
      queueId: reportsQueue.id,
      name: "hourly-usage-rollup",
      jobType: "rollup-usage-stats",
      cronExpression: "*/5 * * * *",
      payload: { granularity: "hourly" },
      nextRunAt: new Date(Date.now() + 60 * 1000),
    },
  });

  await prisma.job.create({
    data: {
      queueId: flakyQueue.id,
      type: "call-unreliable-webhook",
      payload: { url: "https://httpstat.us/500", failAlways: true },
      status: "QUEUED",
      priority: 85,
      maxRetries: 3,
      retryStrategy: RetryStrategy.LINEAR,
      baseDelayMs: 3000,
      createdById: owner.id,
    },
  });

  const batch = await prisma.batch.create({
    data: { projectId: project.id, queueId: emailQueue.id, name: "newsletter-blast-2026-07", totalJobs: 5 },
  });
  await prisma.job.createMany({
    data: Array.from({ length: 5 }).map((_, i) => ({
      queueId: emailQueue.id,
      batchId: batch.id,
      type: "send-newsletter",
      payload: { to: `subscriber${i + 1}@example.com` },
      priority: 30,
      status: "QUEUED" as const,
      createdById: owner.id,
    })),
  });

  // --- Bulk historical + future data so every chart has real variety to show ---

  const history = await generateHistory(allQueues, owner.id, 48);
  const futureCount = await generateFutureSchedule(allQueues, owner.id, 14);
  const cancelledCount = await generateCancelled(allQueues, owner.id, 12);

  console.log("Seed complete.");
  console.log(
    `Generated ${history.jobs} historical jobs (${history.executions} executions, ${history.deadLettered} dead-lettered), ` +
      `${futureCount} future-scheduled jobs, ${cancelledCount} cancelled jobs.`
  );
  console.log("Login with admin@demo.io / member@demo.io, password: Password123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
