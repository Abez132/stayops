import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string; guestId: string }> };

async function getGuestInOrg(organizationId: string, guestId: string) {
  return prisma.guest.findFirst({
    where: { id: guestId, organizationId },
    select: {
      id: true, firstName: true, lastName: true, email: true,
      phone: true, createdAt: true, updatedAt: true,
      reservations: {
        select: {
          id: true, checkIn: true, checkOut: true, status: true,
          totalAmount: true, currency: true,
          property: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { checkIn: "desc" },
        take: 10,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/guests/:guestId
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, guestId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const guest = await getGuestInOrg(organizationId, guestId);
  if (!guest) return NextResponse.json({ error: "Guest not found." }, { status: 404 });

  return NextResponse.json({ guest });
}

// ---------------------------------------------------------------------------
// PATCH /api/organizations/:organizationId/guests/:guestId
// Requires MANAGER+.
// Body: { firstName?, lastName?, email?, phone? }
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { organizationId, guestId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const existing = await prisma.guest.findFirst({ where: { id: guestId, organizationId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Guest not found." }, { status: 404 });

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { firstName, lastName, email, phone } = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  if (firstName !== undefined && (typeof firstName !== "string" || firstName.trim().length < 1)) errors.firstName = "First name must not be empty.";
  if (lastName !== undefined && (typeof lastName !== "string" || lastName.trim().length < 1)) errors.lastName = "Last name must not be empty.";
  if (email !== undefined && (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.email = "A valid email is required.";
  if (phone !== undefined && phone !== null && typeof phone !== "string") errors.phone = "Phone must be a string.";

  if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 422 });

  if (email) {
    const conflict = await prisma.guest.findFirst({
      where: { organizationId, email: (email as string).toLowerCase().trim(), NOT: { id: guestId } },
      select: { id: true },
    });
    if (conflict) return NextResponse.json({ error: "Another guest already uses this email." }, { status: 409 });
  }

  const data: Record<string, unknown> = {};
  if (firstName !== undefined) data.firstName = (firstName as string).trim();
  if (lastName !== undefined) data.lastName = (lastName as string).trim();
  if (email !== undefined) data.email = (email as string).toLowerCase().trim();
  if (phone !== undefined) data.phone = phone ? (phone as string).trim() : null;

  const guest = await prisma.guest.update({
    where: { id: guestId },
    data,
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({ guest });
}

// ---------------------------------------------------------------------------
// DELETE /api/organizations/:organizationId/guests/:guestId
// Requires MANAGER+.
// Blocked if the guest has active (non-completed/cancelled) reservations.
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, guestId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const existing = await prisma.guest.findFirst({ where: { id: guestId, organizationId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Guest not found." }, { status: 404 });

  const activeReservations = await prisma.reservation.count({
    where: {
      guestId,
      status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
    },
  });
  if (activeReservations > 0) {
    return NextResponse.json(
      { error: "Cannot delete a guest with active reservations." },
      { status: 409 }
    );
  }

  await prisma.guest.delete({ where: { id: guestId } });

  return NextResponse.json({ message: "Guest deleted." });
}
