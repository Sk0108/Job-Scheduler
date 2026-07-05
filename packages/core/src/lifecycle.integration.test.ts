import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll } from "vitest";
import { PrismaClient } from "@jsp/db";
import { claimDueJobs, startExecution } from "./claim";
import { recordJobFailure, recordJobSuccess } from "./lifecycle";

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

const orgIdsToClean: string[] = [];

async function makeFixture(jobOverrides: Record<string, unknown> = {}) {
  const org = await prisma.organization.create({ data: { name: `test-${randomUUID()}`, slug: `test-${randomUUID()}` } });
  orgIdsToClean.push(org.id);
  const project = await prisma.project.create({ data: { organizationId: org.id, name: "test", slug: `test-${randomUUID()}` } });
  const queue = await prisma.queue.create({ data: { projectId: project.id, name: "test", slug: `test-${randomUUID()}` } });
  const worker = await prisma.worker.create({ data: { name: `worker-${randomUUID()}`, hostname: "test-host", pid: 1 } });
  const job = await prisma.job.create({ data: { queueId: queue.id, type: "noop", status: "QUEUED", ...jobOverrides } });

  const [claimed] = await claimDueJobs(prisma, { queueId: queue.id, workerId: worker.id, limit: 1 });
  const execution = await startExecution(prisma, claimed.id, worker.id, claimed.attempt + 1);
  return { job: claimed, execution, queue, worker };
}

describe.runIf(dbAvailable)("recordJobFailure — retry vs. dead-letter decision", () => {
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgIdsToClean } } });
    await prisma.$disconnect();
  });

  it("schedules a retry with a future runAt when attempts remain", async () => {
    const { job, execution } = await makeFixture({ maxRetries: 3 });

    const updated = await recordJobFailure(prisma, undefined, {
      jobId: job.id,
      executionId: execution.id,
      durationMs: 50,
      errorMessage: "simulated failure",
    });

    expect(updated.status).toBe("SCHEDULED");
    expect(updated.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(updated.lastError).toBe("simulated failure");

    const dlqCount = await prisma.deadLetterEntry.count({ where: { jobId: job.id } });
    expect(dlqCount).toBe(0);
  });

  it("moves the job to DEAD_LETTER with a DeadLetterEntry once retries are exhausted", async () => {
    const { job, execution } = await makeFixture({ maxRetries: 0 });

    const updated = await recordJobFailure(prisma, undefined, {
      jobId: job.id,
      executionId: execution.id,
      durationMs: 50,
      errorMessage: "permanent failure",
    });

    expect(updated.status).toBe("DEAD_LETTER");

    const entry = await prisma.deadLetterEntry.findFirst({ where: { jobId: job.id } });
    expect(entry).not.toBeNull();
    expect(entry?.lastError).toBe("permanent failure");
    // startExecution() bumps attempt by one when the run begins, so the DLQ snapshot reflects attempt+1.
    expect(entry?.attemptsMade).toBe(job.attempt + 1);
  });

  it("marks the execution row FAILED with the error message attached", async () => {
    const { job, execution } = await makeFixture({ maxRetries: 3 });
    await recordJobFailure(prisma, undefined, {
      jobId: job.id,
      executionId: execution.id,
      durationMs: 42,
      errorMessage: "boom",
    });

    const ex = await prisma.jobExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(ex.status).toBe("FAILED");
    expect(ex.durationMs).toBe(42);
    expect(ex.errorMessage).toBe("boom");
  });
});

describe.runIf(dbAvailable)("recordJobSuccess", () => {
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgIdsToClean } } });
  });

  it("marks the job COMPLETED and clears claim fields", async () => {
    const { job, execution } = await makeFixture();
    const updated = await recordJobSuccess(prisma, undefined, { jobId: job.id, executionId: execution.id, durationMs: 10 });

    expect(updated.status).toBe("COMPLETED");
    expect(updated.claimedByWorkerId).toBeNull();
    expect(updated.completedAt).not.toBeNull();
  });
});

describe.skipIf(dbAvailable)("lifecycle integration", () => {
  it.skip("skipped: no reachable DATABASE_URL — start the docker-compose stack to run this suite", () => {});
});
