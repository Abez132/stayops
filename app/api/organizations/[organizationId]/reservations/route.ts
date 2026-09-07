import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string }> };

const VALID_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED"];

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/reservations
// Query: ?status=CONFIRMED&propertyId=x&guestId=y&page=1&limit=20
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") ?? undefined;
  const propertyId = searchParams.get("propertyId") ?? undefined;
  const guestId = searchParams.get("guestId") ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));

  const where = {
    organizationId,
    ...(status && VALID_STATUSES.includes(status) ? { status: status as never } : {}),
    ...(propertyId ? { propertyId } : {}),
    ...(guestId ? { guestId } : {}),
  };

  const [reservations, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      select: {
        id: true, checkIn: true, checkOut: true, guestsCount: true,
        status: true, totalAmount: true, currency: true,
        specialRequests: true, accessCode: true, accessInstructions: true,
        createdAt: true, updatedAt: true,
        property: { select: { id: true, name: true, slug: true } },
        guest: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { checkIn: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.reservation.count({ where }),
  ]);

  return NextResponse.json({ reservations, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
}

// ---------------------------------------------------------------------------
// POST /api/organizations/:organizationId/reservations
// Requires MANAGER+.
// Body: { propertyId, guestId, checkIn, checkOut, guestsCount, totalAmount,
//         currency?, specialRequests?, accessCode?, accessInstructions? }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const {
    propertyId, guestId, checkIn, checkOut,
    guestsCount, totalAmount, currency,
    specialRequests, accessCode, accessInstructions,
  } = body as Record<string, unknown>;

  const errors: Record<string, string> = {};
  if (!propertyId || typeof propertyId !== "string") errors.propertyId = "propertyId is required.";
  if (!guestId || typeof guestId !== "string") errors.guestId = "guestId is required.";
  if (!checkIn || typeof checkIn !== "string" || isNaN(Date.parse(checkIn))) errors.checkIn = "checkIn must be a valid ISO date.";
  if (!checkOut || typeof checkOut !== "string" || isNaN(Date.parse(checkOut))) errors.checkOut = "checkOut must be a valid ISO date.";
  if (typeof guestsCount !== "number" || guestsCount < 1) errors.guestsCount = "guestsCount must be at least 1.";
  if (typeof totalAmount !== "number" || totalAmount < 0) errors.totalAmount = "totalAmount must be non-negative.";

  if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 422 });

  const checkInDate = new Date(checkIn as string);
  const checkOutDate = new Date(checkOut as string);

  if (checkOutDate <= checkInDate) {
    return NextResponse.json({ error: "checkOut must be after checkIn." }, { status: 422 });
  }

  // Verify property and guest belong to this org
  const [property, guest] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId as string, organizationId }, select: { id: true, maxGuests: true } }),
    prisma.guest.findFirst({ where: { id: guestId as string, organizationId }, select: { id: true } }),
  ]);

  if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });
  if (!guest) return NextResponse.json({ error: "Guest not found." }, { status: 404 });

  if ((guestsCount as number) > property.maxGuests) {
    return NextResponse.json(
      { error: `Property supports a maximum of ${property.maxGuests} guests.` },
      { status: 422 }
    );
  }

  // Check for overlapping confirmed/checked-in reservations on the same property
  const overlap = await prisma.reservation.findFirst({
    where: {
      propertyId: propertyId as string,
      status: { in: ["CONFIRMED", "CHECKED_IN"] },
      AND: [
        { checkIn: { lt: checkOutDate } },
        { checkOut: { gt: checkInDate } },
      ],
    },
    select: { id: true },
  });

  if (overlap) {
    return NextResponse.json(
      { error: "Property is already booked for the selected dates." },
      { status: 409 }
    );
  }

  const reservation = await prisma.reservation.create({
    data: {
      organizationId,
      propertyId: propertyId as string,
      guestId: guestId as string,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      guestsCount: guestsCount as number,
      totalAmount: totalAmount as number,
      currency: typeof currency === "string" ? currency.toUpperCase() : "USD",
      specialRequests: specialRequests ? (specialRequests as string) : null,
      accessCode: accessCode ? (accessCode as string) : null,
      accessInstructions: accessInstructions ? (accessInstructions as string) : null,
      status: "PENDING",
    },
    select: {
      id: true, checkIn: true, checkOut: true, guestsCount: true,
      status: true, totalAmount: true, currency: true,
      specialRequests: true, accessCode: true, accessInstructions: true,
      createdAt: true, updatedAt: true,
      property: { select: { id: true, name: true, slug: true } },
      guest: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  return NextResponse.json({ reservation }, { status: 201 });
}
