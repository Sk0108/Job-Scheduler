import { prisma, OrgRole } from "@jsp/db";
import { ApiError } from "./errors";

const ROLE_RANK: Record<OrgRole, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Throws 403/404 unless the authenticated user is a member of the org (at `minRole`) that owns this project. */
export async function requireProjectAccess(userId: string, projectId: string, minRole: OrgRole = "VIEWER") {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw ApiError.notFound("Project not found");

  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: project.organizationId, userId } },
  });
  if (!membership) throw ApiError.forbidden("You are not a member of this project's organization");
  if (!roleAtLeast(membership.role, minRole)) {
    throw ApiError.forbidden(`Requires ${minRole} role or higher (you have ${membership.role})`);
  }

  return { project, membership };
}

/** Same check, resolved from a queueId — used by nested /queues/:queueId/* routes. */
export async function requireQueueAccess(userId: string, queueId: string, minRole: OrgRole = "VIEWER") {
  const queue = await prisma.queue.findUnique({ where: { id: queueId } });
  if (!queue) throw ApiError.notFound("Queue not found");
  const { project, membership } = await requireProjectAccess(userId, queue.projectId, minRole);
  return { queue, project, membership };
}

/** Same check, resolved from a jobId — used by /jobs/:jobId/* routes. */
export async function requireJobAccess(userId: string, jobId: string, minRole: OrgRole = "VIEWER") {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { queue: true } });
  if (!job) throw ApiError.notFound("Job not found");
  const { project, membership } = await requireProjectAccess(userId, job.queue.projectId, minRole);
  return { job, project, membership };
}

export async function requireOrgAccess(userId: string, organizationId: string, minRole: OrgRole = "VIEWER") {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!membership) throw ApiError.forbidden("You are not a member of this organization");
  if (!roleAtLeast(membership.role, minRole)) {
    throw ApiError.forbidden(`Requires ${minRole} role or higher (you have ${membership.role})`);
  }
  return { membership };
}
