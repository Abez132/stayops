import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireGuestAuth } from "@/app/lib/guest-auth";
import { parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ reservationId: string }> };

// Statuses where access details are safe to reveal to the guest
const ACCESS_VISIBLE_STATUSES = ["CONFIRMED", "CHECKED_IN"];

// Statuses a guest is allowed to cancel from
const CANCELLABLE_STATUSES = ["PENDING", "CONFIRMED"];

async function getGuestReservation(reservationId: string, guestEmail: string) {
  // Join through Guest to verify ownership by email
  return prisma.reservation.findFirst({
    where: {
      id: reservationId,
      guest: { email: guestEmail },
    },
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      guestsCount: true,
      status: true,
      totalAmount: true,
      currency: true,
      specialRequests: true,
      // Access fields — conditionally included in response below
      accessCode: true,
      accessInstructions: true,
      createdAt: true,
      updatedAt: true,
      property: {
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          address: true,
          city: true,
          country: true,
          checkInTime: true,
          checkOutTime: true,
          amenities: true,
          images: {
            select: { id: true, url: true, altText: true, sortOrder: true },
            orderBy: { sortOrder: "asc" as const },
          },
        },
      },
      organization: {
        select: { id: true, name: true, email: true, phone: true },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/guest/reservations/:reservationId
//
// Returns full reservation detail for the authenticated guest.
// accessCode and accessInstructions are only included when status is
// CONFIRMED or CHECKED_IN — not before or after the stay.
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { reservationId } = await params;

  const auth = await requireGuestAuth();
  if (!auth.ok) return auth.response;

  const reservation = await getGuestReservation(reservationId, auth.user.email);
  if (!reservation) {
    return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  }

  const shouldRevealAccess = ACCESS_VISIBLE_STATUSES.includes(reservation.status);

  // Strip access info unless the stay is confirmed or active
  const { accessCode, accessInstructions, ...safeReservation } = reservation;

  return NextResponse.json({
    reservation: {
      ...safeReservation,
      ...(shouldRevealAccess
        ? { accessCode, accessInstructions }
        : { accessCode: null, accessInstructions: null }),
    },
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/guest/reservations/:reservationId
//
// Allows a guest to:
//   - Cancel their reservation (status → CANCELLED), if PENDING or CONFIRMED
//   - Update specialRequests, if still PENDING
//
// Body: { action: "cancel" } | { specialRequests: string }
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { reservationId } = await params;

  const auth = await requireGuestAuth();
  if (!auth.ok) return auth.response;

  const reservation = await getGuestReservation(reservationId, auth.user.email);
  if (!reservation) {
    return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  }

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { action, specialRequests } = body as Record<string, unknown>;

  // ── Cancel ────────────────────────────────────────────────────────────────
  if (action === "cancel") {
    if (!CANCELLABLE_STATUSES.includes(reservation.status)) {
      return NextResponse.json(
        {
          error: `Cannot cancel a reservation with status ${reservation.status}. Only PENDING or CONFIRMED reservations can be cancelled.`,
        },
        { status: 409 }
      );
    }

    const updated = await prisma.reservation.update({
      where: { id: reservationId },
      data: { status: "CANCELLED" },
      select: {
        id: true, status: true, checkIn: true, checkOut: true,
        totalAmount: true, currency: true, updatedAt: true,
      },
    });

    return NextResponse.json({ reservation: updated });
  }

  // ── Update special requests ────────────────────────────────────────────────
  if (specialRequests !== undefined) {
    if (reservation.status !== "PENDING") {
      return NextResponse.json(
        { error: "Special requests can only be updated on PENDING reservations." },
        { status: 409 }
      );
    }

    if (typeof specialRequests !== "string" && specialRequests !== null) {
      return NextResponse.json(
        { error: "specialRequests must be a string or null." },
        { status: 422 }
      );
    }

    const updated = await prisma.reservation.update({
      where: { id: reservationId },
      data: { specialRequests: specialRequests || null },
      select: {
        id: true, status: true, specialRequests: true, updatedAt: true,
      },
    });

    return NextResponse.json({ reservation: updated });
  }

  return NextResponse.json(
    { error: "Provide either action: \"cancel\" or a specialRequests value to update." },
    { status: 422 }
  );
}
