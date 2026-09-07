import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, slugify, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string }> };

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      email: true,
      phone: true,
      logoUrl: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { members: true, properties: true, guests: true, reservations: true },
      },
    },
  });

  if (!organization) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  return NextResponse.json({ organization, myRole: guard.ctx.role });
}

// ---------------------------------------------------------------------------
// PATCH /api/organizations/:organizationId
// Requires OWNER or MANAGER role.
// Body: { name?, email?, phone?, logoUrl? }
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const body = await parseBody(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { name, email, phone, logoUrl } = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2)
      errors.name = "Name must be at least 2 characters.";
  }
  if (email !== undefined) {
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.email = "A valid email address is required.";
  }
  if (phone !== undefined && phone !== null && typeof phone !== "string")
    errors.phone = "Phone must be a string.";
  if (logoUrl !== undefined && logoUrl !== null && typeof logoUrl !== "string")
    errors.logoUrl = "Logo URL must be a string.";

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 });
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) {
    data.name = (name as string).trim();
    // Re-generate slug when name changes
    let slug = slugify(name as string);
    let attempt = 0;
    while (
      await prisma.organization.findFirst({
        where: { slug, NOT: { id: organizationId } },
        select: { id: true },
      })
    ) {
      attempt++;
      slug = `${slugify(name as string)}-${attempt}`;
    }
    data.slug = slug;
  }
  if (email !== undefined) data.email = (email as string).toLowerCase().trim();
  if (phone !== undefined) data.phone = phone ? (phone as string).trim() : null;
  if (logoUrl !== undefined) data.logoUrl = logoUrl ? (logoUrl as string).trim() : null;

  const organization = await prisma.organization.update({
    where: { id: organizationId },
    data,
    select: {
      id: true, name: true, slug: true, email: true,
      phone: true, logoUrl: true, createdAt: true, updatedAt: true,
    },
  });

  return NextResponse.json({ organization });
}

// ---------------------------------------------------------------------------
// DELETE /api/organizations/:organizationId
// Requires OWNER role only.
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "OWNER");
  if (!guard.ok) return guard.response;

  await prisma.organization.delete({ where: { id: organizationId } });

  return NextResponse.json({ message: "Organization deleted." });
}
