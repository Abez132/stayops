import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string }> };

const VALID_TYPES = [
  "RESERVATION_CREATED", "RESERVATION_CONFIRMED", "RESERVATION_CANCELLED",
  "GUEST_CHECKED_IN", "GUEST_CHECKED_OUT",
  "CLEANING_TASK_ASSIGNED", "CLEANING_TASK_COMPLETED",
  "MAINTENANCE_REQUEST_CREATED", "MAINTENANCE_REQUEST_RESOLVED",
  "GENERAL",
];

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/notifications
// Returns notifications for the authenticated user within this org.
// Query: ?isRead=false&page=1&limit=30
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const { searchParams } = request.nextUrl;
  const isReadParam = searchParams.get("isRead");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "30", 10)));

  const where = {
    organizationId,
    userId: guard.ctx.userId,
    ...(isReadParam !== null ? { isRead: isReadParam === "true" } : {}),
  };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      select: {
        id: true, type: true, title: true, message: true, isRead: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { organizationId, userId: guard.ctx.userId, isRead: false } }),
  ]);

  return NextResponse.json({
    notifications,
    meta: { total, page, limit, pages: Math.ceil(total / limit), unreadCount },
  });
}

// ---------------------------------------------------------------------------
// POST /api/organizations/:organizationId/notifications
// Broadcast a notification to one or more org members. Requires MANAGER+.
// Body: { userIds, type, title, message }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { userIds, type, title, message } = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  if (!Array.isArray(userIds) || userIds.length === 0) errors.userIds = "userIds must be a non-empty array of user IDs.";
  if (!type || !VALID_TYPES.includes(type as string)) errors.type = `type must be one of: ${VALID_TYPES.join(", ")}.`;
  if (!title || typeof title !== "string" || title.trim().length < 1) errors.title = "title is required.";
  if (!message || typeof message !== "string" || message.trim().length < 1) errors.message = "message is required.";

  if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 422 });

  // Verify all target users are members of this org
  const members = await prisma.organizationMember.findMany({
    where: { organizationId, userId: { in: userIds as string[] } },
    select: { userId: true },
  });
  const validUserIds = members.map((m: { userId: string }) => m.userId);
  const invalidIds = (userIds as string[]).filter((id) => !validUserIds.includes(id));

  if (invalidIds.length > 0) {
    return NextResponse.json(
      { error: `The following user IDs are not members of this organization: ${invalidIds.join(", ")}.` },
      { status: 422 }
    );
  }

  const created = await prisma.notification.createMany({
    data: validUserIds.map((userId: string) => ({
      organizationId,
      userId,
      type: type as never,
      title: (title as string).trim(),
      message: (message as string).trim(),
    })),
  });

  return NextResponse.json({ message: `${created.count} notification(s) created.` }, { status: 201 });
}
