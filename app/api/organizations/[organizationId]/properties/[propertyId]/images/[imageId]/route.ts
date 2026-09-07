import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody } from "@/app/lib/auth";

type RouteContext = {
  params: Promise<{ organizationId: string; propertyId: string; imageId: string }>;
};

async function getImageInProperty(propertyId: string, imageId: string) {
  return prisma.propertyImage.findFirst({
    where: { id: imageId, propertyId },
    select: { id: true, url: true, altText: true, sortOrder: true, createdAt: true },
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/organizations/:organizationId/properties/:propertyId/images/:imageId
// Update alt text or sort order. Requires MANAGER+.
// Body: { altText?, sortOrder? }
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { organizationId, propertyId, imageId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const existing = await getImageInProperty(propertyId, imageId);
  if (!existing) return NextResponse.json({ error: "Image not found." }, { status: 404 });

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { altText, sortOrder, url } = body as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (url !== undefined) {
    if (typeof url !== "string" || url.trim().length === 0)
      return NextResponse.json({ error: "url must be a non-empty string." }, { status: 422 });
    data.url = url.trim();
  }
  if (altText !== undefined) data.altText = altText ? (altText as string).trim() : null;
  if (sortOrder !== undefined) {
    if (typeof sortOrder !== "number")
      return NextResponse.json({ error: "sortOrder must be a number." }, { status: 422 });
    data.sortOrder = sortOrder;
  }

  const image = await prisma.propertyImage.update({
    where: { id: imageId },
    data,
    select: { id: true, url: true, altText: true, sortOrder: true, createdAt: true },
  });

  return NextResponse.json({ image });
}

// ---------------------------------------------------------------------------
// DELETE /api/organizations/:organizationId/properties/:propertyId/images/:imageId
// Requires MANAGER+.
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, propertyId, imageId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const existing = await getImageInProperty(propertyId, imageId);
  if (!existing) return NextResponse.json({ error: "Image not found." }, { status: 404 });

  await prisma.propertyImage.delete({ where: { id: imageId } });

  return NextResponse.json({ message: "Image deleted." });
}
