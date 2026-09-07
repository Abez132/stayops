import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string; requestId: string }> };

const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const VALID_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED"];

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["RESOLVED", "CANCELLED", "OPEN"],
  RESOLVED: [],
  CANCELLED: [],
};

async function getRequestInOrg(organizationId: string, requestId: string) {
  return prisma.maintenanceRequest.findFirst({
    where: { id: requestId, organizationId },
    select: {
      id: true, title: true, description: true, priority: true,
      status: true, createdAt: true, updatedAt: true, completedAt: true,
      reportedById: true, assignedToId: true,
      property: { select: { id: true, name: true, slug: true } },
      reportedBy: { select: { id: true, role: true, user: { select: { id: true, name: true } } } },
      assignedTo: { select: { id: true, role: true, user: { select: { id: true, name: true } } } },
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/maintenance-requests/:requestId
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, requestId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const request = await getRequestInOrg(organizationId, requestId);
  if (!request) return NextResponse.json({ error: "Maintenance request not found." }, { status: 404 });

  return NextResponse.json({ request });
}

// ---------------------------------------------------------------------------
// PATCH /api/organizations/:organizationId/maintenance-requests/:requestId
// MAINTENANCE members can update status of requests assigned to them.
// MANAGER+ can update everything.
// Body: { status?, priority?, title?, description?, assignedToId? }
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { organizationId, requestId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const current = await getRequestInOrg(organizationId, requestId);
  if (!current) return NextResponse.json({ error: "Maintenance request not found." }, { status: 404 });

  const isManager = guard.ctx.role === "OWNER" || guard.ctx.role === "MANAGER";

  // Non-managers can only update requests assigned to them
  if (!isManager && current.assignedToId !== guard.ctx.memberId) {
    return NextResponse.json(
      { error: "You can only update requests assigned to you." },
      { status: 403 }
    );
  }

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { status, priority, title, description, assignedToId } = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  if (status !== undefined && !VALID_STATUSES.includes(status as string)) errors.status = `Must be one of: ${VALID_STATUSES.join(", ")}.`;
  if (priority !== undefined && !VALID_PRIORITIES.includes(priority as string)) errors.priority = `Must be one of: ${VALID_PRIORITIES.join(", ")}.`;
  if (title !== undefined && (typeof title !== "string" || title.trim().length < 3)) errors.title = "Title must be at least 3 characters.";
  if (description !== undefined && (typeof description !== "string" || description.trim().length < 5)) errors.description = "Description must be at least 5 characters.";
  if (assignedToId !== undefined && assignedToId !== null && typeof assignedToId !== "string") errors.assignedToId = "assignedToId must be a string.";

  if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 422 });

  if (status && status !== current.status) {
    const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(status as string)) {
      return NextResponse.json(
        { error: `Cannot transition from ${current.status} to ${status}.` },
        { status: 422 }
      );
    }
  }

  if (assignedToId && !isManager) {
    return NextResponse.json({ error: "Only managers can reassign requests." }, { status: 403 });
  }

  if (assignedToId) {
    const assignee = await prisma.organizationMember.findFirst({ where: { id: assignedToId as string, organizationId }, select: { id: true } });
    if (!assignee) return NextResponse.json({ error: "Assignee member not found." }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (status !== undefined) {
    data.status = status;
    if (status === "RESOLVED") data.completedAt = new Date();
    if (status !== "RESOLVED") data.completedAt = null;
  }
  if (priority !== undefined) data.priority = priority;
  if (title !== undefined) data.title = (title as string).trim();
  if (description !== undefined) data.description = (description as string).trim();
  if (assignedToId !== undefined) data.assignedToId = assignedToId || null;

  const updated = await prisma.maintenanceRequest.update({
    where: { id: requestId },
    data,
    select: {
      id: true, title: true, description: true, priority: true,
      status: true, createdAt: true, updatedAt: true, completedAt: true,
      property: { select: { id: true, name: true } },
      reportedBy: { select: { id: true, user: { select: { id: true, name: true } } } },
      assignedTo: { select: { id: true, user: { select: { id: true, name: true } } } },
    },
  });

  return NextResponse.json({ request: updated });
}

// ---------------------------------------------------------------------------
// DELETE /api/organizations/:organizationId/maintenance-requests/:requestId
// Requires MANAGER+. Only OPEN or CANCELLED requests can be deleted.
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, requestId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const existing = await prisma.maintenanceRequest.findFirst({
    where: { id: requestId, organizationId },
    select: { id: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: "Maintenance request not found." }, { status: 404 });

  if (!["OPEN", "CANCELLED"].includes(existing.status)) {
    return NextResponse.json(
      { error: "Only OPEN or CANCELLED requests can be deleted." },
      { status: 409 }
    );
  }

  await prisma.maintenanceRequest.delete({ where: { id: requestId } });

  return NextResponse.json({ message: "Maintenance request deleted." });
}
