import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string; propertyId: string }> };

async function verifyPropertyInOrg(organizationId: string, propertyId: string) {
  return prisma.property.findFirst({
    where: { id: propertyId, organizationId },
    select: { id: true },
  });
}

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/properties/:propertyId/images
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, propertyId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const property = await verifyPropertyInOrg(organizationId, propertyId);
  if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });

  const images = await prisma.propertyImage.findMany({
    where: { propertyId },
    select: { id: true, url: true, altText: true, sortOrder: true, createdAt: true },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ images });
}

// ---------------------------------------------------------------------------
// POST /api/organizations/:organizationId/properties/:propertyId/images
// Adds an image record (URL must already be uploaded externally).
// Requires MANAGER+.
// Body: { url, altText?, sortOrder? }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { organizationId, propertyId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const property = await verifyPropertyInOrg(organizationId, propertyId);
  if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { url, altText, sortOrder } = body as Record<string, unknown>;

  if (!url || typeof url !== "string" || url.trim().length === 0) {
    return NextResponse.json({ error: "url is required." }, { status: 422 });
  }

  // Default sortOrder to one past the current max
  let resolvedSortOrder: number;
  if (typeof sortOrder === "number") {
    resolvedSortOrder = sortOrder;
  } else {
    const last = await prisma.propertyImage.findFirst({
      where: { propertyId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    resolvedSortOrder = (last?.sortOrder ?? -1) + 1;
  }

  const image = await prisma.propertyImage.create({
    data: {
      propertyId,
      url: url.trim(),
      altText: typeof altText === "string" ? altText.trim() : null,
      sortOrder: resolvedSortOrder,
    },
    select: { id: true, url: true, altText: true, sortOrder: true, createdAt: true },
  });

  return NextResponse.json({ image }, { status: 201 });
}
