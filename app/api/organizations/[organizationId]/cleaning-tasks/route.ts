import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string }> };

const VALID_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"];

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/cleaning-tasks
// Query: ?status=PENDING&propertyId=x&assignedToId=y&page=1&limit=20
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") ?? undefined;
  const propertyId = searchParams.get("propertyId") ?? undefined;
  const assignedToId = searchParams.get("assignedToId") ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));

  const where = {
    organizationId,
    ...(status && VALID_STATUSES.includes(status) ? { status: status as never } : {}),
    ...(propertyId ? { propertyId } : {}),
    ...(assignedToId ? { assignedToId } : {}),
  };

  const [tasks, total] = await Promise.all([
    prisma.cleaningTask.findMany({
      where,
      select: {
        id: true, status: true, scheduledAt: true,
        startedAt: true, completedAt: true, notes: true,
        createdAt: true, updatedAt: true,
        property: { select: { id: true, name: true, slug: true } },
        reservation: { select: { id: true, checkIn: true, checkOut: true } },
        assignedTo: { select: { id: true, role: true, user: { select: { id: true, name: true, email: true } } } },
      },
      orderBy: { scheduledAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.cleaningTask.count({ where }),
  ]);

  return NextResponse.json({ tasks, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
}

// ---------------------------------------------------------------------------
// POST /api/organizations/:organizationId/cleaning-tasks
// Requires MANAGER+.
// Body: { propertyId, reservationId, assignedToId, scheduledAt, notes? }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { propertyId, reservationId, assignedToId, scheduledAt, notes } = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  if (!propertyId || typeof propertyId !== "string") errors.propertyId = "propertyId is required.";
  if (!reservationId || typeof reservationId !== "string") errors.reservationId = "reservationId is required.";
  if (!assignedToId || typeof assignedToId !== "string") errors.assignedToId = "assignedToId is required.";
  if (!scheduledAt || typeof scheduledAt !== "string" || isNaN(Date.parse(scheduledAt))) errors.scheduledAt = "scheduledAt must be a valid ISO datetime.";

  if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 422 });

  // Verify all related records belong to this org
  const [property, reservation, assignee] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId as string, organizationId }, select: { id: true } }),
    prisma.reservation.findFirst({ where: { id: reservationId as string, organizationId }, select: { id: true } }),
    prisma.organizationMember.findFirst({ where: { id: assignedToId as string, organizationId }, select: { id: true } }),
  ]);

  if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });
  if (!reservation) return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  if (!assignee) return NextResponse.json({ error: "Assignee member not found." }, { status: 404 });

  const task = await prisma.cleaningTask.create({
    data: {
      organizationId,
      propertyId: propertyId as string,
      reservationId: reservationId as string,
      assignedToId: assignedToId as string,
      scheduledAt: new Date(scheduledAt as string),
      notes: notes ? (notes as string) : null,
      status: "PENDING",
    },
    select: {
      id: true, status: true, scheduledAt: true, notes: true, createdAt: true, updatedAt: true,
      property: { select: { id: true, name: true } },
      reservation: { select: { id: true, checkIn: true, checkOut: true } },
      assignedTo: { select: { id: true, role: true, user: { select: { id: true, name: true } } } },
    },
  });

  return NextResponse.json({ task }, { status: 201 });
}
