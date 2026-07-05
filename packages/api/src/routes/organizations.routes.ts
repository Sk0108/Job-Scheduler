import { Router } from "express";
import { z } from "zod";
import { prisma } from "@jsp/db";
import { asyncHandler } from "../middleware/async-handler";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { ApiError } from "../lib/errors";
import { requireOrgAccess } from "../lib/access";

export const organizationsRouter = Router();
organizationsRouter.use(requireAuth);

const createOrgSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with dashes"),
});

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
});

const updateMemberSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
});

organizationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: req.userId! },
      include: { organization: true },
    });
    res.json({
      data: memberships.map((m) => ({ id: m.organization.id, name: m.organization.name, slug: m.organization.slug, role: m.role })),
    });
  })
);

organizationsRouter.post(
  "/",
  validate(createOrgSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.organization.findUnique({ where: { slug: req.body.slug } });
    if (existing) throw ApiError.conflict("An organization with this slug already exists");

    const org = await prisma.organization.create({
      data: {
        name: req.body.name,
        slug: req.body.slug,
        members: { create: { userId: req.userId!, role: "OWNER" } },
      },
    });
    res.status(201).json(org);
  })
);

organizationsRouter.get(
  "/:orgId/members",
  asyncHandler(async (req, res) => {
    await requireOrgAccess(req.userId!, req.params.orgId, "VIEWER");
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: req.params.orgId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json({ data: members.map((m) => ({ id: m.id, role: m.role, user: m.user, createdAt: m.createdAt })) });
  })
);

organizationsRouter.post(
  "/:orgId/members",
  validate(addMemberSchema),
  asyncHandler(async (req, res) => {
    await requireOrgAccess(req.userId!, req.params.orgId, "ADMIN");

    const user = await prisma.user.findUnique({ where: { email: req.body.email } });
    if (!user) throw ApiError.notFound("No user with that email exists yet — they must register first");

    const member = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: req.params.orgId, userId: user.id } },
      update: { role: req.body.role },
      create: { organizationId: req.params.orgId, userId: user.id, role: req.body.role },
    });
    res.status(201).json(member);
  })
);

organizationsRouter.patch(
  "/:orgId/members/:memberId",
  validate(updateMemberSchema),
  asyncHandler(async (req, res) => {
    const { membership } = await requireOrgAccess(req.userId!, req.params.orgId, "OWNER");
    const target = await prisma.organizationMember.findUnique({ where: { id: req.params.memberId } });
    if (!target || target.organizationId !== req.params.orgId) throw ApiError.notFound("Member not found");
    if (target.id === membership.id && req.body.role !== "OWNER") {
      throw ApiError.badRequest("Owners cannot demote themselves; transfer ownership to another member first");
    }
    const updated = await prisma.organizationMember.update({ where: { id: req.params.memberId }, data: { role: req.body.role } });
    res.json(updated);
  })
);

organizationsRouter.delete(
  "/:orgId/members/:memberId",
  asyncHandler(async (req, res) => {
    await requireOrgAccess(req.userId!, req.params.orgId, "ADMIN");
    const target = await prisma.organizationMember.findUnique({ where: { id: req.params.memberId } });
    if (!target || target.organizationId !== req.params.orgId) throw ApiError.notFound("Member not found");
    await prisma.organizationMember.delete({ where: { id: req.params.memberId } });
    res.status(204).send();
  })
);

const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with dashes"),
  description: z.string().max(500).optional(),
});

organizationsRouter.get(
  "/:orgId/projects",
  asyncHandler(async (req, res) => {
    await requireOrgAccess(req.userId!, req.params.orgId, "VIEWER");
    const projects = await prisma.project.findMany({
      where: { organizationId: req.params.orgId },
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: projects });
  })
);

organizationsRouter.post(
  "/:orgId/projects",
  validate(createProjectSchema),
  asyncHandler(async (req, res) => {
    await requireOrgAccess(req.userId!, req.params.orgId, "ADMIN");
    const existing = await prisma.project.findUnique({
      where: { organizationId_slug: { organizationId: req.params.orgId, slug: req.body.slug } },
    });
    if (existing) throw ApiError.conflict("A project with this slug already exists in this organization");

    const project = await prisma.project.create({
      data: { organizationId: req.params.orgId, name: req.body.name, slug: req.body.slug, description: req.body.description },
    });
    res.status(201).json(project);
  })
);
