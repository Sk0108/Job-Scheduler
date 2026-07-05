import { Router } from "express";
import { z } from "zod";
import { prisma, RetryStrategy } from "@jsp/db";
import { asyncHandler } from "../middleware/async-handler";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { ApiError } from "../lib/errors";
import { requireProjectAccess } from "../lib/access";
import { getSystemHealth } from "@jsp/core";

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const updateProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
});

projectsRouter.get(
  "/:projectId",
  asyncHandler(async (req, res) => {
    const { project } = await requireProjectAccess(req.userId!, req.params.projectId, "VIEWER");
    res.json(project);
  })
);

projectsRouter.patch(
  "/:projectId",
  validate(updateProjectSchema),
  asyncHandler(async (req, res) => {
    await requireProjectAccess(req.userId!, req.params.projectId, "ADMIN");
    const updated = await prisma.project.update({ where: { id: req.params.projectId }, data: req.body });
    res.json(updated);
  })
);

projectsRouter.delete(
  "/:projectId",
  asyncHandler(async (req, res) => {
    await requireProjectAccess(req.userId!, req.params.projectId, "OWNER");
    await prisma.project.delete({ where: { id: req.params.projectId } });
    res.status(204).send();
  })
);

projectsRouter.get(
  "/:projectId/health",
  asyncHandler(async (req, res) => {
    await requireProjectAccess(req.userId!, req.params.projectId, "VIEWER");
    res.json(await getSystemHealth(prisma, req.params.projectId));
  })
);

// ---------------------------------------------------------------------------
// Retry policies (named, reusable — referenced as a queue's default policy)
// ---------------------------------------------------------------------------

const retryPolicySchema = z.object({
  name: z.string().min(1).max(80),
  strategy: z.nativeEnum(RetryStrategy).default("EXPONENTIAL"),
  maxRetries: z.number().int().min(0).max(50).default(5),
  baseDelayMs: z.number().int().min(0).default(1000),
  maxDelayMs: z.number().int().min(0).default(300_000),
  jitter: z.boolean().default(true),
});

projectsRouter.get(
  "/:projectId/retry-policies",
  asyncHandler(async (req, res) => {
    await requireProjectAccess(req.userId!, req.params.projectId, "VIEWER");
    const policies = await prisma.retryPolicy.findMany({ where: { projectId: req.params.projectId }, orderBy: { name: "asc" } });
    res.json({ data: policies });
  })
);

projectsRouter.post(
  "/:projectId/retry-policies",
  validate(retryPolicySchema),
  asyncHandler(async (req, res) => {
    await requireProjectAccess(req.userId!, req.params.projectId, "ADMIN");
    const existing = await prisma.retryPolicy.findUnique({
      where: { projectId_name: { projectId: req.params.projectId, name: req.body.name } },
    });
    if (existing) throw ApiError.conflict("A retry policy with this name already exists in this project");

    const policy = await prisma.retryPolicy.create({ data: { projectId: req.params.projectId, ...req.body } });
    res.status(201).json(policy);
  })
);

export const retryPoliciesRouter = Router();
retryPoliciesRouter.use(requireAuth);

retryPoliciesRouter.patch(
  "/:policyId",
  validate(retryPolicySchema.partial()),
  asyncHandler(async (req, res) => {
    const policy = await prisma.retryPolicy.findUnique({ where: { id: req.params.policyId } });
    if (!policy) throw ApiError.notFound("Retry policy not found");
    await requireProjectAccess(req.userId!, policy.projectId, "ADMIN");
    const updated = await prisma.retryPolicy.update({ where: { id: req.params.policyId }, data: req.body });
    res.json(updated);
  })
);

retryPoliciesRouter.delete(
  "/:policyId",
  asyncHandler(async (req, res) => {
    const policy = await prisma.retryPolicy.findUnique({ where: { id: req.params.policyId } });
    if (!policy) throw ApiError.notFound("Retry policy not found");
    await requireProjectAccess(req.userId!, policy.projectId, "ADMIN");
    await prisma.retryPolicy.delete({ where: { id: req.params.policyId } });
    res.status(204).send();
  })
);
