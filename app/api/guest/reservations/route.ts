import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireGuestAuth, findOrCreateGuest } from "@/app/lib/guest-auth";
import { parseBody } from "@/app/lib/auth";

// ---------------------------------------------------------------------------
// GET /api/guest/reservations
//
// Returns all reservations belonging to the authenticated guest,
// across all organizations.
// Query: ?status=CONFIRMED&page=1&limit=20
// ---------------------------------------------------------------------------

const VALID_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED"];

export async function GET(request: NextRequest) {
  const auth = await requireGuestAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));

  // Find all Guest CRM records linked to this user's email across all orgs
  const guestRecords = await prisma.guest.findMany({
    where: { email: auth.user.email },
    select: { id: true },
  });
  const guestIds = guestRecords.map((g: { id: string }) => g.id);

  if (guestIds.length === 0) {
    return NextResponse.json({
      reservations: [],
      meta: { total: 0, page, limit, pages: 0 },
    });
  }

  const where = {
    guestId: { in: guestIds },
    ...(status && VALID_STATUSES.includes(status) ? { status: status as never } : {}),
  };

  const [reservations, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        guestsCount: true,
        status: true,
        totalAmount: true,
        currency: true,
        specialRequests: true,
        createdAt: true,
        updatedAt: true,
        property: {
          select: {
            id: true,
            name: true,
            slug: true,
            city: true,
            country: true,
            checkInTime: true,
            checkOutTime: true,
            images: {
              select: { url: true, altText: true },
              orderBy: { sortOrder: "asc" as const },
              take: 1,
            },
          },
        },
        organization: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { checkIn: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.reservation.count({ where }),
  ]);

  // Never expose accessCode/accessInstructions in the list view
  return NextResponse.json({
    reservations,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}

// ---------------------------------------------------------------------------
// POST /api/guest/reservations
//
// Authenticated guest requests a booking. Auto-creates/finds the Guest CRM
// record for the property's organization, calculates the total from
// pricePerNight × nights, and creates the reservation with status PENDING.
//
// Body: { propertyId, checkIn, checkOut, guestsCount, specialRequests? }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const auth = await requireGuestAuth();
  if (!auth.ok) return auth.response;

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { propertyId, checkIn, checkOut, guestsCount, specialRequests } =
    body as Record<string, unknown>;

  const errors: Record<string, string> = {};
  if (!propertyId || typeof propertyId !== "string") errors.propertyId = "propertyId is required.";
  if (!checkIn || typeof checkIn !== "string" || isNaN(Date.parse(checkIn))) errors.checkIn = "checkIn must be a valid ISO date.";
  if (!checkOut || typeof checkOut !== "string" || isNaN(Date.parse(checkOut))) errors.checkOut = "checkOut must be a valid ISO date.";
  if (typeof guestsCount !== "number" || guestsCount < 1) errors.guestsCount = "guestsCount must be at least 1.";

  if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 422 });

  const checkInDate = new Date(checkIn as string);
  const checkOutDate = new Date(checkOut as string);

  if (checkOutDate <= checkInDate) {
    return NextResponse.json({ error: "checkOut must be after checkIn." }, { status: 422 });
  }

  if (checkInDate < new Date(new Date().toDateString())) {
    return NextResponse.json({ error: "checkIn cannot be in the past." }, { status: 422 });
  }

  // Fetch the property — must be PUBLISHED
  const property = await prisma.property.findFirst({
    where: { id: propertyId as string, status: "PUBLISHED" },
    select: {
      id: true,
      organizationId: true,
      maxGuests: true,
      pricePerNight: true,
      currency: true,
      name: true,
    },
  });

  if (!property) {
    return NextResponse.json({ error: "Property not found or not available." }, { status: 404 });
  }

  if ((guestsCount as number) > property.maxGuests) {
    return NextResponse.json(
      { error: `Property supports a maximum of ${property.maxGuests} guests.` },
      { status: 422 }
    );
  }

  // Check availability — no overlapping CONFIRMED or CHECKED_IN bookings
  const conflict = await prisma.reservation.findFirst({
    where: {
      propertyId: property.id,
      status: { in: ["CONFIRMED", "CHECKED_IN"] },
      checkIn: { lt: checkOutDate },
      checkOut: { gt: checkInDate },
    },
    select: { id: true },
  });

  if (conflict) {
    return NextResponse.json(
      { error: "Property is not available for the selected dates." },
      { status: 409 }
    );
  }

  // Calculate total: pricePerNight × number of nights
  const nights = Math.round(
    (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const totalAmount = Number(property.pricePerNight) * nights;

  // Find or create the Guest CRM record for this org
  const guestId = await findOrCreateGuest(property.organizationId, auth.user);

  const reservation = await prisma.reservation.create({
    data: {
      organizationId: property.organizationId,
      propertyId: property.id,
      guestId,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      guestsCount: guestsCount as number,
      totalAmount,
      currency: property.currency,
      specialRequests: specialRequests ? (specialRequests as string) : null,
      status: "PENDING",
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
      createdAt: true,
      property: {
        select: { id: true, name: true, slug: true, city: true, country: true, checkInTime: true, checkOutTime: true },
      },
      organization: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ reservation }, { status: 201 });
}
