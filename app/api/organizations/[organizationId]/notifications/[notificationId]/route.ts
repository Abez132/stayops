import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string; notificationId: string }> };

async function getNotificationForUser(organizationId: string, notificationId: string, userId: string) {
  return prisma.notification.findFirst({
    where: { id: notificationId, organizationId, userId },
    select: { id: true, type: true, title: true, message: true, isRead: true, createdAt: true },
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/organizations/:organizationId/notifications/:notificationId
// Mark as read/unread. Users can only update their own notifications.
// Body: { isRead }
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { organizationId, notificationId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const existing = await getNotificationForUser(organizationId, notificationId, guard.ctx.userId);
  if (!existing) return NextResponse.json({ error: "Notification not found." }, { status: 404 });

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { isRead } = body as Record<string, unknown>;
  if (typeof isRead !== "boolean") {
    return NextResponse.json({ error: "isRead must be a boolean." }, { status: 422 });
  }

  const notification = await prisma.notification.update({
    where: { id: notificationId },
    data: { isRead },
    select: { id: true, type: true, title: true, message: true, isRead: true, createdAt: true },
  });

  return NextResponse.json({ notification });
}

// ---------------------------------------------------------------------------
// DELETE /api/organizations/:organizationId/notifications/:notificationId
// Users can delete their own notifications. Managers can delete any.
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, notificationId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const isManager = guard.ctx.role === "OWNER" || guard.ctx.role === "MANAGER";

  const existing = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      organizationId,
      // Non-managers can only delete their own
      ...(isManager ? {} : { userId: guard.ctx.userId }),
    },
    select: { id: true },
  });

  if (!existing) return NextResponse.json({ error: "Notification not found." }, { status: 404 });

  await prisma.notification.delete({ where: { id: notificationId } });

  return NextResponse.json({ message: "Notification deleted." });
}
