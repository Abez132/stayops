import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireAuth, slugify, parseBody } from "@/app/lib/auth";

// ---------------------------------------------------------------------------
// GET /api/organizations
// Returns all organizations the authenticated user is a member of.
// ---------------------------------------------------------------------------
export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: auth.userId },
    select: {
      id: true,
      role: true,
      createdAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          phone: true,
          logoUrl: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { members: true, properties: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const organizations = memberships.map((m: (typeof memberships)[number]) => ({
    ...m.organization,
    myRole: m.role,
    membershipId: m.id,
  }));

  return NextResponse.json({ organizations });
}

// ---------------------------------------------------------------------------
// POST /api/organizations
// Creates a new organization. The creator is automatically added as OWNER.
// Body: { name, email, phone?, logoUrl? }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const body = await parseBody(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { name, email, phone, logoUrl } = body as Record<string, unknown>;

  const errors: Record<string, string> = {};
  if (!name || typeof name !== "string" || name.trim().length < 2)
    errors.name = "Name must be at least 2 characters.";
  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email as string))
    errors.email = "A valid email address is required.";
  if (phone !== undefined && typeof phone !== "string")
    errors.phone = "Phone must be a string.";
  if (logoUrl !== undefined && typeof logoUrl !== "string")
    errors.logoUrl = "Logo URL must be a string.";

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 });
  }

  // Generate a unique slug, appending a counter if there is a conflict
  let slug = slugify(name as string);
  let attempt = 0;
  while (await prisma.organization.findUnique({ where: { slug }, select: { id: true } })) {
    attempt++;
    slug = `${slugify(name as string)}-${attempt}`;
  }

  const organization = await prisma.organization.create({
    data: {
      name: (name as string).trim(),
      slug,
      email: (email as string).toLowerCase().trim(),
      phone: phone ? (phone as string).trim() : null,
      logoUrl: logoUrl ? (logoUrl as string).trim() : null,
      members: {
        create: { userId: auth.userId, role: "OWNER" },
      },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      email: true,
      phone: true,
      logoUrl: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ organization }, { status: 201 });
}
