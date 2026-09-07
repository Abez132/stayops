import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireGuestAuth } from "@/app/lib/guest-auth";
import { parseBody } from "@/app/lib/auth";

// ---------------------------------------------------------------------------
// GET /api/guest/profile
//
// Returns the authenticated user's profile and a summary of their booking
// history (counts by status, not the full list).
// ---------------------------------------------------------------------------

export async function GET() {
  const auth = await requireGuestAuth();
  if (!auth.ok) return auth.response;

  const user = await prisma.user.findUnique({
    where: { id: auth.user.userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // Aggregate booking counts across all Guest CRM records linked to this email
  const guestRecords = await prisma.guest.findMany({
    where: { email: user.email },
    select: { id: true },
  });
  const guestIds = guestRecords.map((g: { id: string }) => g.id);

  const bookingCounts = await prisma.reservation.groupBy({
    by: ["status"],
    where: { guestId: { in: guestIds } },
    _count: { id: true },
  });

  const bookingSummary = bookingCounts.reduce(
    (acc: Record<string, number>, row: { status: string; _count: { id: number } }) => {
      acc[row.status] = row._count.id;
      return acc;
    },
    {} as Record<string, number>
  );

  return NextResponse.json({ user, bookingSummary });
}

// ---------------------------------------------------------------------------
// PATCH /api/guest/profile
//
// Updates name and/or phone. Email changes are not allowed here — that
// would require re-verification and is out of scope.
//
// Body: { name?, phone? }
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  const auth = await requireGuestAuth();
  if (!auth.ok) return auth.response;

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { name, phone } = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2)
      errors.name = "Name must be at least 2 characters.";
  }
  if (phone !== undefined && phone !== null && typeof phone !== "string") {
    errors.phone = "Phone must be a string.";
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 });
  }

  if (name === undefined && phone === undefined) {
    return NextResponse.json(
      { error: "Provide at least one field to update (name or phone)." },
      { status: 422 }
    );
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = (name as string).trim();
  if (phone !== undefined) data.phone = phone ? (phone as string).trim() : null;

  const user = await prisma.user.update({
    where: { id: auth.user.userId },
    data,
    select: { id: true, name: true, email: true, phone: true, updatedAt: true },
  });

  // Propagate name change to all linked Guest CRM records so org dashboards
  // stay in sync. Only update firstName/lastName — email stays canonical.
  if (name !== undefined) {
    const parts = (name as string).trim().split(/\s+/);
    const firstName = parts[0] ?? (name as string);
    const lastName = parts.slice(1).join(" ") || undefined;

    await prisma.guest.updateMany({
      where: { email: user.email },
      data: {
        firstName,
        ...(lastName ? { lastName } : {}),
      },
    });
  }

  return NextResponse.json({ user });
}
