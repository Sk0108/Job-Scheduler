import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll } from "vitest";
import { PrismaClient } from "@jsp/db";
import { claimDueJobs } from "./claim";

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

const orgIdsToClean: string[] = [];

async function makeFixture(jobCount: number) {
  const org = await prisma.organization.create({ data: { name: `test-${randomUUID()}`, slug: `test-${randomUUID()}` } });
  orgIdsToClean.push(org.id);
  const project = await prisma.project.create({ data: { organizationId: org.id, name: "test", slug: `test-${randomUUID()}` } });
  const queue = await prisma.queue.create({ data: { projectId: project.id, name: "test", slug: `test-${randomUUID()}`, concurrencyLimit: 1000 } });

  await prisma.job.createMany({
    data: Array.from({ length: jobCount }).map(() => ({
      queueId: queue.id,
      type: "noop",
      status: "QUEUED" as const,
    })),
  });

  const workers = await Promise.all(
    Array.from({ length: 5 }).map((_, i) =>
      prisma.worker.create({ data: { name: `worker-${i}-${randomUUID()}`, hostname: "test-host", pid: 1000 + i } })
    )
  );

  return { queue, workers };
}

describe.runIf(dbAvailable)("claimDueJobs — atomic claim under concurrency", () => {
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgIdsToClean } } });
    await prisma.$disconnect();
  });

  it("never lets two concurrent claimers take the same job, and claims every job exactly once", async () => {
    const jobCount = 40;
    const { queue, workers } = await makeFixture(jobCount);

    // 5 "workers" race to claim from the same queue at once — this is the scenario that would
    // produce duplicate execution if claiming weren't a single atomic SQL statement.
    const results = await Promise.all(workers.map((w) => claimDueJobs(prisma, { queueId: queue.id, workerId: w.id, limit: 15 })));

    const claimedIds = results.flatMap((r) => r.map((j) => j.id));
    const uniqueIds = new Set(claimedIds);

    expect(claimedIds.length).toBe(jobCount);
    expect(uniqueIds.size).toBe(jobCount);

    const stillQueued = await prisma.job.count({ where: { queueId: queue.id, status: "QUEUED" } });
    expect(stillQueued).toBe(0);

    const claimedInDb = await prisma.job.count({ where: { queueId: queue.id, status: "CLAIMED" } });
    expect(claimedInDb).toBe(jobCount);
  });

  it("respects the requested limit and leaves the remainder QUEUED for the next poll", async () => {
    const { queue, workers } = await makeFixture(10);
    const claimed = await claimDueJobs(prisma, { queueId: queue.id, workerId: workers[0].id, limit: 4 });
    expect(claimed).toHaveLength(4);

    const stillQueued = await prisma.job.count({ where: { queueId: queue.id, status: "QUEUED" } });
    expect(stillQueued).toBe(6);
  });

  it("does not claim jobs whose runAt is in the future", async () => {
    const { queue, workers } = await makeFixture(0);
    await prisma.job.create({
      data: { queueId: queue.id, type: "noop", status: "QUEUED", runAt: new Date(Date.now() + 60_000) },
    });

    const claimed = await claimDueJobs(prisma, { queueId: queue.id, workerId: workers[0].id, limit: 10 });
    expect(claimed).toHaveLength(0);
  });
});

describe.skipIf(dbAvailable)("claimDueJobs — atomic claim under concurrency", () => {
  it.skip("skipped: no reachable DATABASE_URL — start the docker-compose stack to run this suite", () => {});
});
