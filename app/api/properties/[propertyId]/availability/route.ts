import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";

type RouteContext = { params: Promise<{ propertyId: string }> };

// ---------------------------------------------------------------------------
// GET /api/properties/:propertyId/availability
//
// Public endpoint — no auth required.
// Returns booked date ranges so a calendar UI can block them out.
//
// Query params:
//   from   ISO date  — start of the window to check (default: today)
//   to     ISO date  — end   of the window to check (default: +90 days)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { propertyId } = await params;

  // Verify the property exists and is published
  const property = await prisma.property.findFirst({
    where: { id: propertyId, status: "PUBLISHED" },
    select: { id: true },
  });

  if (!property) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  const { searchParams } = request.nextUrl;
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");

  const from = fromStr && !isNaN(Date.parse(fromStr))
    ? new Date(fromStr)
    : new Date();

  const to = toStr && !isNaN(Date.parse(toStr))
    ? new Date(toStr)
    : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  if (to <= from) {
    return NextResponse.json(
      { error: "to must be after from." },
      { status: 400 }
    );
  }

  // Return reservations that overlap the requested window and block the property
  const reservations = await prisma.reservation.findMany({
    where: {
      propertyId,
      status: { in: ["CONFIRMED", "CHECKED_IN"] },
      checkIn: { lt: to },
      checkOut: { gt: from },
    },
    select: { checkIn: true, checkOut: true },
    orderBy: { checkIn: "asc" },
  });

  const blockedRanges = reservations.map((r: { checkIn: Date; checkOut: Date }) => ({
    checkIn: r.checkIn,
    checkOut: r.checkOut,
  }));

  return NextResponse.json({ propertyId, from, to, blockedRanges });
}
