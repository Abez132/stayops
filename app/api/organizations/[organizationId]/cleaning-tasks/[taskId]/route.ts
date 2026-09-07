import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string; taskId: string }> };

const VALID_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"];

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["IN_PROGRESS"],
  IN_PROGRESS: ["COMPLETED", "PENDING"],
  COMPLETED: [],
};

async function getTaskInOrg(organizationId: string, taskId: string) {
  return prisma.cleaningTask.findFirst({
    where: { id: taskId, organizationId },
    select: {
      id: true, status: true, scheduledAt: true,
      startedAt: true, completedAt: true, notes: true,
      createdAt: true, updatedAt: true, assignedToId: true,
      property: { select: { id: true, name: true } },
      reservation: { select: { id: true, checkIn: true, checkOut: true } },
      assignedTo: { select: { id: true, role: true, user: { select: { id: true, name: true } } } },
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/cleaning-tasks/:taskId
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, taskId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const task = await getTaskInOrg(organizationId, taskId);
  if (!task) return NextResponse.json({ error: "Cleaning task not found." }, { status: 404 });

  return NextResponse.json({ task });
}

// ---------------------------------------------------------------------------
// PATCH /api/organizations/:organizationId/cleaning-tasks/:taskId
// Cleaners can update status of tasks assigned to them.
// Managers can also reassign and update notes.
// Body: { status?, assignedToId?, scheduledAt?, notes? }
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { organizationId, taskId } = await params;

  // CLEANER can update their own task status; MANAGER can do everything
  const guard = await requireOrgRole(organizationId, "CLEANER");
  if (!guard.ok) return guard.response;

  const current = await getTaskInOrg(organizationId, taskId);
  if (!current) return NextResponse.json({ error: "Cleaning task not found." }, { status: 404 });

  // Cleaners can only update tasks assigned to them
  const isManager = guard.ctx.role === "OWNER" || guard.ctx.role === "MANAGER";
  if (!isManager && current.assignedToId !== guard.ctx.memberId) {
    return NextResponse.json({ error: "You can only update tasks assigned to you." }, { status: 403 });
  }

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { status, assignedToId, scheduledAt, notes } = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  if (status !== undefined && !VALID_STATUSES.includes(status as string)) {
    errors.status = `Must be one of: ${VALID_STATUSES.join(", ")}.`;
  }
  if (scheduledAt !== undefined && (typeof scheduledAt !== "string" || isNaN(Date.parse(scheduledAt as string)))) {
    errors.scheduledAt = "scheduledAt must be a valid ISO datetime.";
  }

  if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 422 });

  // Enforce status transitions
  if (status && status !== current.status) {
    const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(status as string)) {
      return NextResponse.json(
        { error: `Cannot transition from ${current.status} to ${status}.` },
        { status: 422 }
      );
    }
  }

  // Only managers can reassign
  if (assignedToId && !isManager) {
    return NextResponse.json({ error: "Only managers can reassign tasks." }, { status: 403 });
  }

  if (assignedToId) {
    const assignee = await prisma.organizationMember.findFirst({
      where: { id: assignedToId as string, organizationId },
      select: { id: true },
    });
    if (!assignee) return NextResponse.json({ error: "Assignee member not found." }, { status: 404 });
  }

  const now = new Date();
  const data: Record<string, unknown> = {};
  if (status !== undefined) {
    data.status = status;
    if (status === "IN_PROGRESS" && !current.startedAt) data.startedAt = now;
    if (status === "COMPLETED") data.completedAt = now;
    if (status === "PENDING") { data.startedAt = null; data.completedAt = null; }
  }
  if (assignedToId !== undefined) data.assignedToId = assignedToId;
  if (scheduledAt !== undefined) data.scheduledAt = new Date(scheduledAt as string);
  if (notes !== undefined) data.notes = notes || null;

  const task = await prisma.cleaningTask.update({
    where: { id: taskId },
    data,
    select: {
      id: true, status: true, scheduledAt: true,
      startedAt: true, completedAt: true, notes: true,
      createdAt: true, updatedAt: true,
      property: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, role: true, user: { select: { id: true, name: true } } } },
    },
  });

  return NextResponse.json({ task });
}

// ---------------------------------------------------------------------------
// DELETE /api/organizations/:organizationId/cleaning-tasks/:taskId
// Requires MANAGER+. Only PENDING tasks can be deleted.
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, taskId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const existing = await prisma.cleaningTask.findFirst({
    where: { id: taskId, organizationId },
    select: { id: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: "Cleaning task not found." }, { status: 404 });

  if (existing.status !== "PENDING") {
    return NextResponse.json({ error: "Only PENDING tasks can be deleted." }, { status: 409 });
  }

  await prisma.cleaningTask.delete({ where: { id: taskId } });

  return NextResponse.json({ message: "Cleaning task deleted." });
}
