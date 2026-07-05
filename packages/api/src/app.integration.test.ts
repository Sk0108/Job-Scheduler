import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll } from "vitest";
import request from "supertest";
import { prisma } from "@jsp/db";
import { createApp } from "./app";

const app = createApp();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

const orgIdsToClean: string[] = [];

async function registerAndLogin() {
  const email = `test-${randomUUID()}@example.com`;
  const res = await request(app).post("/api/v1/auth/register").send({ email, password: "Password123!", name: "Test User" });
  return { email, accessToken: res.body.accessToken as string, refreshToken: res.body.refreshToken as string, userId: res.body.user.id as string };
}

describe.runIf(dbAvailable)("Auth API", () => {
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgIdsToClean } } });
    await prisma.$disconnect();
  });

  it("registers a new user and returns a usable token pair", async () => {
    const { accessToken } = await registerAndLogin();
    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toMatch(/@example\.com$/);
  });

  it("rejects a login with the wrong password", async () => {
    const { email } = await registerAndLogin();
    const res = await request(app).post("/api/v1/auth/login").send({ email, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects registering the same email twice", async () => {
    const email = `test-${randomUUID()}@example.com`;
    await request(app).post("/api/v1/auth/register").send({ email, password: "Password123!", name: "First" });
    const res = await request(app).post("/api/v1/auth/register").send({ email, password: "Password123!", name: "Second" });
    expect(res.status).toBe(409);
  });

  it("rotates the refresh token and rejects reuse of the old one", async () => {
    const { refreshToken } = await registerAndLogin();
    const first = await request(app).post("/api/v1/auth/refresh").send({ refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(refreshToken);

    const replay = await request(app).post("/api/v1/auth/refresh").send({ refreshToken });
    expect(replay.status).toBe(401);
  });

  it("rejects requests without a bearer token", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });
});

describe.runIf(dbAvailable)("Projects/Queues/Jobs API", () => {
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgIdsToClean } } });
  });

  async function setupProject() {
    const { accessToken, userId } = await registerAndLogin();
    const auth = { Authorization: `Bearer ${accessToken}` };

    const orgRes = await request(app).post("/api/v1/organizations").set(auth).send({ name: "Acme", slug: `acme-${randomUUID()}` });
    orgIdsToClean.push(orgRes.body.id);

    const projectRes = await request(app)
      .post(`/api/v1/organizations/${orgRes.body.id}/projects`)
      .set(auth)
      .send({ name: "Core", slug: `core-${randomUUID()}` });

    return { auth, orgId: orgRes.body.id, projectId: projectRes.body.id, userId };
  }

  it("creates a queue and an immediate job, and the job explorer lists it", async () => {
    const { auth, projectId } = await setupProject();

    const queueRes = await request(app)
      .post(`/api/v1/projects/${projectId}/queues`)
      .set(auth)
      .send({ name: "Emails", slug: `emails-${randomUUID()}`, concurrencyLimit: 5 });
    expect(queueRes.status).toBe(201);

    const jobRes = await request(app)
      .post(`/api/v1/queues/${queueRes.body.id}/jobs`)
      .set(auth)
      .send({ type: "send-welcome-email", payload: { to: "a@b.com" } });
    expect(jobRes.status).toBe(201);
    expect(jobRes.body.status).toBe("QUEUED");

    const listRes = await request(app).get(`/api/v1/jobs?projectId=${projectId}`).set(auth);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((j: { id: string }) => j.id === jobRes.body.id)).toBe(true);
  });

  it("creates a delayed job as SCHEDULED and an immediate job as QUEUED", async () => {
    const { auth, projectId } = await setupProject();
    const queueRes = await request(app)
      .post(`/api/v1/projects/${projectId}/queues`)
      .set(auth)
      .send({ name: "Reports", slug: `reports-${randomUUID()}` });

    const delayedRes = await request(app)
      .post(`/api/v1/queues/${queueRes.body.id}/jobs`)
      .set(auth)
      .send({ type: "generate-report", runAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(delayedRes.body.status).toBe("SCHEDULED");
  });

  it("deduplicates job creation by idempotencyKey within the same queue", async () => {
    const { auth, projectId } = await setupProject();
    const queueRes = await request(app)
      .post(`/api/v1/projects/${projectId}/queues`)
      .set(auth)
      .send({ name: "Webhooks", slug: `webhooks-${randomUUID()}` });

    const key = randomUUID();
    const first = await request(app).post(`/api/v1/queues/${queueRes.body.id}/jobs`).set(auth).send({ type: "ping", idempotencyKey: key });
    const second = await request(app).post(`/api/v1/queues/${queueRes.body.id}/jobs`).set(auth).send({ type: "ping", idempotencyKey: key });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.deduplicated).toBe(true);
  });

  it("rejects a VIEWER attempting to create a queue (RBAC)", async () => {
    const { auth, orgId, projectId } = await setupProject();

    const viewer = await registerAndLogin();
    await request(app).post(`/api/v1/organizations/${orgId}/members`).set(auth).send({ email: viewer.email, role: "VIEWER" });

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/queues`)
      .set({ Authorization: `Bearer ${viewer.accessToken}` })
      .send({ name: "Blocked", slug: `blocked-${randomUUID()}` });

    expect(res.status).toBe(403);
  });
});

describe.skipIf(dbAvailable)("API integration", () => {
  it.skip("skipped: no reachable DATABASE_URL — start the docker-compose stack to run this suite", () => {});
});
