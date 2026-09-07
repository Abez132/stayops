import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, slugify, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string }> };

const VALID_TYPES = ["APARTMENT", "HOUSE", "VILLA", "STUDIO", "HOTEL", "GUESTHOUSE", "OTHER"];
const VALID_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"];

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/properties
// Query params: ?status=PUBLISHED&city=Addis&page=1&limit=20
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") ?? undefined;
  const city = searchParams.get("city") ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));

  const where = {
    organizationId,
    ...(status && VALID_STATUSES.includes(status) ? { status: status as never } : {}),
    ...(city ? { city: { contains: city, mode: "insensitive" as const } } : {}),
  };

  const [properties, total] = await Promise.all([
    prisma.property.findMany({
      where,
      select: {
        id: true, name: true, slug: true, propertyType: true, status: true,
        city: true, country: true, bedrooms: true, bathrooms: true,
        maxGuests: true, pricePerNight: true, currency: true, amenities: true,
        checkInTime: true, checkOutTime: true, createdAt: true, updatedAt: true,
        images: { select: { id: true, url: true, altText: true, sortOrder: true }, orderBy: { sortOrder: "asc" }, take: 1 },
        _count: { select: { reservations: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.property.count({ where }),
  ]);

  return NextResponse.json({ properties, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
}

// ---------------------------------------------------------------------------
// POST /api/organizations/:organizationId/properties
// Requires MANAGER+.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const {
    name, propertyType, address, city, country,
    bedrooms, bathrooms, maxGuests, pricePerNight, currency,
    description, status, amenities, checkInTime, checkOutTime, accessInstructions,
  } = body as Record<string, unknown>;

  const errors: Record<string, string> = {};
  if (!name || typeof name !== "string" || name.trim().length < 2) errors.name = "Name is required.";
  if (!propertyType || !VALID_TYPES.includes(propertyType as string)) errors.propertyType = `Must be one of: ${VALID_TYPES.join(", ")}.`;
  if (!address || typeof address !== "string") errors.address = "Address is required.";
  if (!city || typeof city !== "string") errors.city = "City is required.";
  if (!country || typeof country !== "string") errors.country = "Country is required.";
  if (typeof bedrooms !== "number" || bedrooms < 0) errors.bedrooms = "bedrooms must be a non-negative number.";
  if (typeof bathrooms !== "number" || bathrooms < 0) errors.bathrooms = "bathrooms must be a non-negative number.";
  if (typeof maxGuests !== "number" || maxGuests < 1) errors.maxGuests = "maxGuests must be at least 1.";
  if (typeof pricePerNight !== "number" || pricePerNight < 0) errors.pricePerNight = "pricePerNight must be a non-negative number.";
  if (status !== undefined && !VALID_STATUSES.includes(status as string)) errors.status = `Must be one of: ${VALID_STATUSES.join(", ")}.`;
  if (amenities !== undefined && !Array.isArray(amenities)) errors.amenities = "amenities must be an array of strings.";

  if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 422 });

  // Generate unique slug within the org
  let slug = slugify(name as string);
  let attempt = 0;
  while (await prisma.property.findUnique({ where: { organizationId_slug: { organizationId, slug } }, select: { id: true } })) {
    attempt++;
    slug = `${slugify(name as string)}-${attempt}`;
  }

  const property = await prisma.property.create({
    data: {
      organizationId,
      name: (name as string).trim(),
      slug,
      propertyType: propertyType as never,
      address: (address as string).trim(),
      city: (city as string).trim(),
      country: (country as string).trim(),
      bedrooms: bedrooms as number,
      bathrooms: bathrooms as number,
      maxGuests: maxGuests as number,
      pricePerNight: pricePerNight as number,
      currency: typeof currency === "string" ? currency.toUpperCase() : "USD",
      description: description ? (description as string).trim() : null,
      status: (status as never) ?? "DRAFT",
      amenities: Array.isArray(amenities) ? (amenities as string[]) : [],
      checkInTime: checkInTime ? (checkInTime as string) : null,
      checkOutTime: checkOutTime ? (checkOutTime as string) : null,
      accessInstructions: accessInstructions ? (accessInstructions as string) : null,
    },
    select: {
      id: true, name: true, slug: true, propertyType: true, status: true,
      address: true, city: true, country: true, bedrooms: true, bathrooms: true,
      maxGuests: true, pricePerNight: true, currency: true, amenities: true,
      checkInTime: true, checkOutTime: true, createdAt: true, updatedAt: true,
    },
  });

  return NextResponse.json({ property }, { status: 201 });
}
