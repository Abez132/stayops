import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, slugify, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string; propertyId: string }> };

const VALID_TYPES = ["APARTMENT", "HOUSE", "VILLA", "STUDIO", "HOTEL", "GUESTHOUSE", "OTHER"];
const VALID_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"];

async function getPropertyInOrg(organizationId: string, propertyId: string) {
  return prisma.property.findFirst({
    where: { id: propertyId, organizationId },
    select: {
      id: true, name: true, slug: true, propertyType: true, status: true,
      description: true, address: true, city: true, country: true,
      bedrooms: true, bathrooms: true, maxGuests: true,
      pricePerNight: true, currency: true, amenities: true,
      checkInTime: true, checkOutTime: true, accessInstructions: true,
      createdAt: true, updatedAt: true,
      images: { select: { id: true, url: true, altText: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
      _count: { select: { reservations: true, cleaningTasks: true, maintenanceRequests: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/properties/:propertyId
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, propertyId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const property = await getPropertyInOrg(organizationId, propertyId);
  if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });

  return NextResponse.json({ property });
}

// ---------------------------------------------------------------------------
// PATCH /api/organizations/:organizationId/properties/:propertyId
// Requires MANAGER+.
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { organizationId, propertyId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const existing = await prisma.property.findFirst({
    where: { id: propertyId, organizationId },
    select: { id: true, name: true },
  });
  if (!existing) return NextResponse.json({ error: "Property not found." }, { status: 404 });

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const {
    name, propertyType, address, city, country,
    bedrooms, bathrooms, maxGuests, pricePerNight, currency,
    description, status, amenities, checkInTime, checkOutTime, accessInstructions,
  } = body as Record<string, unknown>;

  const errors: Record<string, string> = {};
  if (name !== undefined && (typeof name !== "string" || name.trim().length < 2)) errors.name = "Name must be at least 2 characters.";
  if (propertyType !== undefined && !VALID_TYPES.includes(propertyType as string)) errors.propertyType = `Must be one of: ${VALID_TYPES.join(", ")}.`;
  if (status !== undefined && !VALID_STATUSES.includes(status as string)) errors.status = `Must be one of: ${VALID_STATUSES.join(", ")}.`;
  if (bedrooms !== undefined && (typeof bedrooms !== "number" || bedrooms < 0)) errors.bedrooms = "Must be a non-negative number.";
  if (bathrooms !== undefined && (typeof bathrooms !== "number" || bathrooms < 0)) errors.bathrooms = "Must be a non-negative number.";
  if (maxGuests !== undefined && (typeof maxGuests !== "number" || maxGuests < 1)) errors.maxGuests = "Must be at least 1.";
  if (pricePerNight !== undefined && (typeof pricePerNight !== "number" || pricePerNight < 0)) errors.pricePerNight = "Must be non-negative.";
  if (amenities !== undefined && !Array.isArray(amenities)) errors.amenities = "Must be an array.";

  if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 422 });

  const data: Record<string, unknown> = {};
  if (name !== undefined) {
    data.name = (name as string).trim();
    let slug = slugify(name as string);
    let attempt = 0;
    while (await prisma.property.findFirst({ where: { organizationId, slug, NOT: { id: propertyId } }, select: { id: true } })) {
      attempt++;
      slug = `${slugify(name as string)}-${attempt}`;
    }
    data.slug = slug;
  }
  if (propertyType !== undefined) data.propertyType = propertyType;
  if (address !== undefined) data.address = (address as string).trim();
  if (city !== undefined) data.city = (city as string).trim();
  if (country !== undefined) data.country = (country as string).trim();
  if (bedrooms !== undefined) data.bedrooms = bedrooms;
  if (bathrooms !== undefined) data.bathrooms = bathrooms;
  if (maxGuests !== undefined) data.maxGuests = maxGuests;
  if (pricePerNight !== undefined) data.pricePerNight = pricePerNight;
  if (currency !== undefined) data.currency = (currency as string).toUpperCase();
  if (description !== undefined) data.description = description ? (description as string).trim() : null;
  if (status !== undefined) data.status = status;
  if (amenities !== undefined) data.amenities = amenities;
  if (checkInTime !== undefined) data.checkInTime = checkInTime || null;
  if (checkOutTime !== undefined) data.checkOutTime = checkOutTime || null;
  if (accessInstructions !== undefined) data.accessInstructions = accessInstructions || null;

  const property = await prisma.property.update({
    where: { id: propertyId },
    data,
    select: {
      id: true, name: true, slug: true, propertyType: true, status: true,
      address: true, city: true, country: true, bedrooms: true, bathrooms: true,
      maxGuests: true, pricePerNight: true, currency: true, amenities: true,
      checkInTime: true, checkOutTime: true, createdAt: true, updatedAt: true,
    },
  });

  return NextResponse.json({ property });
}

// ---------------------------------------------------------------------------
// DELETE /api/organizations/:organizationId/properties/:propertyId
// Requires OWNER only.
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, propertyId } = await params;

  const guard = await requireOrgRole(organizationId, "OWNER");
  if (!guard.ok) return guard.response;

  const existing = await prisma.property.findFirst({ where: { id: propertyId, organizationId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Property not found." }, { status: 404 });

  await prisma.property.delete({ where: { id: propertyId } });

  return NextResponse.json({ message: "Property deleted." });
}
