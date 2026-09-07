import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string; reservationId: string }> };

const VALID_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED"];

// Status transition rules — key: current status, value: allowed next statuses
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED"],
  CHECKED_IN: ["CHECKED_OUT"],
  CHECKED_OUT: [],
  CANCELLED: [],
};

async function getReservationInOrg(organizationId: string, reservationId: string) {
  return prisma.reservation.findFirst({
    where: { id: reservationId, organizationId },
    select: {
      id: true, checkIn: true, checkOut: true, guestsCount: true,
      status: true, totalAmount: true, currency: true,
      specialRequests: true, accessCode: true, accessInstructions: true,
      createdAt: true, updatedAt: true,
      property: { select: { id: true, name: true, slug: true } },
      guest: { select: { id: true, firstName: true, lastName: true, email: true } },
      cleaningTasks: {
        select: { id: true, status: true, scheduledAt: true, assignedTo: { select: { user: { select: { id: true, name: true } } } } },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/reservations/:reservationId
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, reservationId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const reservation = await getReservationInOrg(organizationId, reservationId);
  if (!reservation) return NextResponse.json({ error: "Reservation not found." }, { status: 404 });

  return NextResponse.json({ reservation });
}

// ---------------------------------------------------------------------------
// PATCH /api/organizations/:organizationId/reservations/:reservationId
// Requires MANAGER+.
// Body: { status?, specialRequests?, accessCode?, accessInstructions?, guestsCount?, totalAmount? }
// When status transitions to CHECKED_OUT, a CleaningTask is automatically created.
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { organizationId, reservationId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const current = await prisma.reservation.findFirst({
    where: { id: reservationId, organizationId },
    select: { id: true, status: true, propertyId: true },
  });
  if (!current) return NextResponse.json({ error: "Reservation not found." }, { status: 404 });

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const {
    status, specialRequests, accessCode, accessInstructions,
    guestsCount, totalAmount,
  } = body as Record<string, unknown>;

  const errors: Record<string, string> = {};
  if (status !== undefined && !VALID_STATUSES.includes(status as string)) {
    errors.status = `Must be one of: ${VALID_STATUSES.join(", ")}.`;
  }
  if (guestsCount !== undefined && (typeof guestsCount !== "number" || guestsCount < 1)) {
    errors.guestsCount = "guestsCount must be at least 1.";
  }
  if (totalAmount !== undefined && (typeof totalAmount !== "number" || totalAmount < 0)) {
    errors.totalAmount = "totalAmount must be non-negative.";
  }

  if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 422 });

  // Enforce status transition rules
  if (status && status !== current.status) {
    const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(status as string)) {
      return NextResponse.json(
        { error: `Cannot transition from ${current.status} to ${status}.` },
        { status: 422 }
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (status !== undefined) data.status = status;
  if (specialRequests !== undefined) data.specialRequests = specialRequests || null;
  if (accessCode !== undefined) data.accessCode = accessCode || null;
  if (accessInstructions !== undefined) data.accessInstructions = accessInstructions || null;
  if (guestsCount !== undefined) data.guestsCount = guestsCount;
  if (totalAmount !== undefined) data.totalAmount = totalAmount;

  const reservation = await prisma.reservation.update({
    where: { id: reservationId },
    data,
    select: {
      id: true, checkIn: true, checkOut: true, guestsCount: true,
      status: true, totalAmount: true, currency: true,
      specialRequests: true, accessCode: true, accessInstructions: true,
      createdAt: true, updatedAt: true,
      property: { select: { id: true, name: true } },
      guest: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  // When a guest checks out, automatically create a cleaning task
  if (status === "CHECKED_OUT") {
    const checkOutDate = new Date(reservation.checkOut);
    await prisma.cleaningTask.create({
      data: {
        organizationId,
        propertyId: current.propertyId,
        reservationId,
        // Default: assign to the acting member; can be reassigned later
        assignedToId: guard.ctx.memberId,
        status: "PENDING",
        scheduledAt: checkOutDate,
      },
    });
  }

  return NextResponse.json({ reservation });
}

// ---------------------------------------------------------------------------
// DELETE /api/organizations/:organizationId/reservations/:reservationId
// Requires OWNER only. Only PENDING or CANCELLED reservations can be deleted.
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, reservationId } = await params;

  const guard = await requireOrgRole(organizationId, "OWNER");
  if (!guard.ok) return guard.response;

  const existing = await prisma.reservation.findFirst({
    where: { id: reservationId, organizationId },
    select: { id: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: "Reservation not found." }, { status: 404 });

  if (!["PENDING", "CANCELLED"].includes(existing.status)) {
    return NextResponse.json(
      { error: "Only PENDING or CANCELLED reservations can be deleted." },
      { status: 409 }
    );
  }

  await prisma.reservation.delete({ where: { id: reservationId } });

  return NextResponse.json({ message: "Reservation deleted." });
}
