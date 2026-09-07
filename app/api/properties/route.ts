import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";

// ---------------------------------------------------------------------------
// GET /api/properties
//
// Public endpoint — no auth required.
// Returns all PUBLISHED properties with optional filters.
//
// Query params:
//   city         string   — case-insensitive partial match
//   country      string   — case-insensitive partial match
//   type         string   — PropertyType enum value
//   checkIn      ISO date — filter out properties with conflicting bookings
//   checkOut     ISO date — paired with checkIn
//   guests       number   — min maxGuests required
//   minPrice     number   — min pricePerNight
//   maxPrice     number   — max pricePerNight
//   amenities    string   — comma-separated list; property must have ALL of them
//   page         number   — default 1
//   limit        number   — default 20, max 100
// ---------------------------------------------------------------------------

const VALID_TYPES = ["APARTMENT", "HOUSE", "VILLA", "STUDIO", "HOTEL", "GUESTHOUSE", "OTHER"];

const PROPERTY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  propertyType: true,
  city: true,
  country: true,
  address: true,
  bedrooms: true,
  bathrooms: true,
  maxGuests: true,
  pricePerNight: true,
  currency: true,
  amenities: true,
  checkInTime: true,
  checkOutTime: true,
  createdAt: true,
  organization: {
    select: { id: true, name: true, slug: true, logoUrl: true },
  },
  images: {
    select: { id: true, url: true, altText: true, sortOrder: true },
    orderBy: { sortOrder: "asc" as const },
  },
} as const;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const city = searchParams.get("city") ?? undefined;
  const country = searchParams.get("country") ?? undefined;
  const type = searchParams.get("type") ?? undefined;
  const checkInStr = searchParams.get("checkIn") ?? undefined;
  const checkOutStr = searchParams.get("checkOut") ?? undefined;
  const guestsParam = searchParams.get("guests");
  const minPriceParam = searchParams.get("minPrice");
  const maxPriceParam = searchParams.get("maxPrice");
  const amenitiesParam = searchParams.get("amenities");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));

  // ── Date validation ────────────────────────────────────────────────────
  let checkIn: Date | undefined;
  let checkOut: Date | undefined;

  if (checkInStr || checkOutStr) {
    if (!checkInStr || !checkOutStr) {
      return NextResponse.json(
        { error: "Both checkIn and checkOut are required when filtering by dates." },
        { status: 400 }
      );
    }
    if (isNaN(Date.parse(checkInStr)) || isNaN(Date.parse(checkOutStr))) {
      return NextResponse.json(
        { error: "checkIn and checkOut must be valid ISO dates." },
        { status: 400 }
      );
    }
    checkIn = new Date(checkInStr);
    checkOut = new Date(checkOutStr);
    if (checkOut <= checkIn) {
      return NextResponse.json(
        { error: "checkOut must be after checkIn." },
        { status: 400 }
      );
    }
  }

  const guests = guestsParam ? parseInt(guestsParam, 10) : undefined;
  const minPrice = minPriceParam ? parseFloat(minPriceParam) : undefined;
  const maxPrice = maxPriceParam ? parseFloat(maxPriceParam) : undefined;
  const requiredAmenities = amenitiesParam
    ? amenitiesParam.split(",").map((a) => a.trim()).filter(Boolean)
    : undefined;

  // ── Build where clause ─────────────────────────────────────────────────
  // If dates given, exclude properties with overlapping CONFIRMED/CHECKED_IN reservations
  let excludedPropertyIds: string[] | undefined;
  if (checkIn && checkOut) {
    const conflicting = await prisma.reservation.findMany({
      where: {
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
      },
      select: { propertyId: true },
    });
    excludedPropertyIds = Array.from(new Set(conflicting.map((r: { propertyId: string }) => r.propertyId))) as string[];
  }

  const where = {
    status: "PUBLISHED" as const,
    ...(city ? { city: { contains: city, mode: "insensitive" as const } } : {}),
    ...(country ? { country: { contains: country, mode: "insensitive" as const } } : {}),
    ...(type && VALID_TYPES.includes(type) ? { propertyType: type as never } : {}),
    ...(guests ? { maxGuests: { gte: guests } } : {}),
    ...(minPrice !== undefined ? { pricePerNight: { gte: minPrice } } : {}),
    ...(maxPrice !== undefined
      ? {
          pricePerNight: {
            ...(minPrice !== undefined ? { gte: minPrice } : {}),
            lte: maxPrice,
          },
        }
      : {}),
    ...(requiredAmenities && requiredAmenities.length > 0
      ? { amenities: { hasEvery: requiredAmenities } }
      : {}),
    ...(excludedPropertyIds && excludedPropertyIds.length > 0
      ? { id: { notIn: excludedPropertyIds } }
      : {}),
  };

  const [properties, total] = await Promise.all([
    prisma.property.findMany({
      where,
      select: PROPERTY_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.property.count({ where }),
  ]);

  return NextResponse.json({
    properties,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}
