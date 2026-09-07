import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string }> };

const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const VALID_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED"];

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/maintenance-requests
// Query: ?status=OPEN&priority=HIGH&propertyId=x&page=1&limit=20
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") ?? undefined;
  const priority = searchParams.get("priority") ?? undefined;
  const propertyId = searchParams.get("propertyId") ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));

  const where = {
    organizationId,
    ...(status && VALID_STATUSES.includes(status) ? { status: status as never } : {}),
    ...(priority && VALID_PRIORITIES.includes(priority) ? { priority: priority as never } : {}),
    ...(propertyId ? { propertyId } : {}),
  };

  const [requests, total] = await Promise.all([
    prisma.maintenanceRequest.findMany({
      where,
      select: {
        id: true, title: true, description: true, priority: true,
        status: true, createdAt: true, updatedAt: true, completedAt: true,
        property: { select: { id: true, name: true, slug: true } },
        reportedBy: { select: { id: true, role: true, user: { select: { id: true, name: true } } } },
        assignedTo: { select: { id: true, role: true, user: { select: { id: true, name: true } } } },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.maintenanceRequest.count({ where }),
  ]);

  return NextResponse.json({ requests, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
}

// ---------------------------------------------------------------------------
// POST /api/organizations/:organizationId/maintenance-requests
// Any member can report. assignedToId is optional.
// Body: { propertyId, title, description, priority?, assignedToId? }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { propertyId, title, description, priority, assignedToId } = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  if (!propertyId || typeof propertyId !== "string") errors.propertyId = "propertyId is required.";
  if (!title || typeof title !== "string" || title.trim().length < 3) errors.title = "Title must be at least 3 characters.";
  if (!description || typeof description !== "string" || description.trim().length < 5) errors.description = "Description must be at least 5 characters.";
  if (priority !== undefined && !VALID_PRIORITIES.includes(priority as string)) errors.priority = `Must be one of: ${VALID_PRIORITIES.join(", ")}.`;
  if (assignedToId !== undefined && typeof assignedToId !== "string") errors.assignedToId = "assignedToId must be a string.";

  if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 422 });

  const property = await prisma.property.findFirst({ where: { id: propertyId as string, organizationId }, select: { id: true } });
  if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });

  if (assignedToId) {
    const assignee = await prisma.organizationMember.findFirst({ where: { id: assignedToId as string, organizationId }, select: { id: true } });
    if (!assignee) return NextResponse.json({ error: "Assignee member not found." }, { status: 404 });
  }

  const request_ = await prisma.maintenanceRequest.create({
    data: {
      organizationId,
      propertyId: propertyId as string,
      reportedById: guard.ctx.memberId,
      assignedToId: assignedToId ? (assignedToId as string) : null,
      title: (title as string).trim(),
      description: (description as string).trim(),
      priority: (priority as never) ?? "MEDIUM",
      status: "OPEN",
    },
    select: {
      id: true, title: true, description: true, priority: true,
      status: true, createdAt: true, updatedAt: true,
      property: { select: { id: true, name: true } },
      reportedBy: { select: { id: true, user: { select: { id: true, name: true } } } },
      assignedTo: { select: { id: true, user: { select: { id: true, name: true } } } },
    },
  });

  return NextResponse.json({ request: request_ }, { status: 201 });
}
