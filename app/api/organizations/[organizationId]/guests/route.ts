import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string }> };

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/guests
// Query: ?search=abebe&page=1&limit=20
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search") ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));

  const where = {
    organizationId,
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: "insensitive" as const } },
            { lastName: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [guests, total] = await Promise.all([
    prisma.guest.findMany({
      where,
      select: {
        id: true, firstName: true, lastName: true, email: true,
        phone: true, createdAt: true, updatedAt: true,
        _count: { select: { reservations: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.guest.count({ where }),
  ]);

  return NextResponse.json({ guests, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
}

// ---------------------------------------------------------------------------
// POST /api/organizations/:organizationId/guests
// Requires MANAGER+.
// Body: { firstName, lastName, email, phone? }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { firstName, lastName, email, phone } = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  if (!firstName || typeof firstName !== "string" || firstName.trim().length < 1) errors.firstName = "First name is required.";
  if (!lastName || typeof lastName !== "string" || lastName.trim().length < 1) errors.lastName = "Last name is required.";
  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "A valid email is required.";
  if (phone !== undefined && phone !== null && typeof phone !== "string") errors.phone = "Phone must be a string.";

  if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 422 });

  const existing = await prisma.guest.findUnique({
    where: { organizationId_email: { organizationId, email: (email as string).toLowerCase().trim() } },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ error: "A guest with this email already exists in this organization." }, { status: 409 });

  const guest = await prisma.guest.create({
    data: {
      organizationId,
      firstName: (firstName as string).trim(),
      lastName: (lastName as string).trim(),
      email: (email as string).toLowerCase().trim(),
      phone: phone ? (phone as string).trim() : null,
    },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({ guest }, { status: 201 });
}
