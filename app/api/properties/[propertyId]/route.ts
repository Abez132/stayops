import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";

type RouteContext = { params: Promise<{ propertyId: string }> };

// ---------------------------------------------------------------------------
// GET /api/properties/:propertyId
//
// Public endpoint — no auth required.
// Returns full detail for a single PUBLISHED property.
// accessInstructions is intentionally omitted — that is only revealed to
// guests after a reservation is CONFIRMED (via /api/guest/reservations/:id).
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { propertyId } = await params;

  const property = await prisma.property.findFirst({
    where: {
      id: propertyId,
      status: "PUBLISHED",
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      propertyType: true,
      address: true,
      city: true,
      country: true,
      bedrooms: true,
      bathrooms: true,
      maxGuests: true,
      pricePerNight: true,
      currency: true,
      amenities: true,
      checkInTime: true,
      checkOutTime: true,
      createdAt: true,
      updatedAt: true,
      // accessInstructions deliberately excluded from public response
      organization: {
        select: { id: true, name: true, slug: true, logoUrl: true, email: true, phone: true },
      },
      images: {
        select: { id: true, url: true, altText: true, sortOrder: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!property) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  return NextResponse.json({ property });
}
