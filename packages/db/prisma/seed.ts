import { PrismaClient, RetryStrategy } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

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

  // Immediate job
  await prisma.job.create({
    data: {
      queueId: emailQueue.id,
      type: "send-welcome-email",
      payload: { to: "new-user@example.com", template: "welcome" },
      status: "QUEUED",
      createdById: owner.id,
    },
  });

  // Delayed job (runs in 2 minutes)
  await prisma.job.create({
    data: {
      queueId: emailQueue.id,
      type: "send-followup-email",
      payload: { to: "new-user@example.com", template: "followup" },
      status: "SCHEDULED",
      runAt: new Date(Date.now() + 2 * 60 * 1000),
      createdById: owner.id,
    },
  });

  // Scheduled job (runs at a fixed future time)
  await prisma.job.create({
    data: {
      queueId: reportsQueue.id,
      type: "generate-monthly-report",
      payload: { month: "2026-07" },
      status: "SCHEDULED",
      runAt: new Date(Date.now() + 5 * 60 * 1000),
      timeoutMs: 60000,
      createdById: owner.id,
    },
  });

  // Recurring cron job definition — every 5 minutes
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

  // A job intentionally designed to fail repeatedly to demonstrate retries + DLQ
  await prisma.job.create({
    data: {
      queueId: flakyQueue.id,
      type: "call-unreliable-webhook",
      payload: { url: "https://httpstat.us/500", failAlways: true },
      status: "QUEUED",
      maxRetries: 3,
      retryStrategy: RetryStrategy.LINEAR,
      baseDelayMs: 3000,
      createdById: owner.id,
    },
  });

  // Batch of jobs
  const batch = await prisma.batch.create({
    data: {
      projectId: project.id,
      queueId: emailQueue.id,
      name: "newsletter-blast-2026-07",
      totalJobs: 5,
    },
  });

  await prisma.job.createMany({
    data: Array.from({ length: 5 }).map((_, i) => ({
      queueId: emailQueue.id,
      batchId: batch.id,
      type: "send-newsletter",
      payload: { to: `subscriber${i + 1}@example.com` },
      status: "QUEUED" as const,
      createdById: owner.id,
    })),
  });

  console.log("Seed complete.");
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
