import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody, type MemberRole } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string }> };

const VALID_ROLES: MemberRole[] = ["OWNER", "MANAGER", "CLEANER", "MAINTENANCE"];

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/members
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const members = await prisma.organizationMember.findMany({
    where: { organizationId },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ members });
}

// ---------------------------------------------------------------------------
// POST /api/organizations/:organizationId/members
// Adds an existing user to the organization. Requires MANAGER+.
// Body: { userId, role }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { organizationId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { userId, role } = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  if (!userId || typeof userId !== "string") errors.userId = "userId is required.";
  if (!role || !VALID_ROLES.includes(role as MemberRole))
    errors.role = `role must be one of: ${VALID_ROLES.join(", ")}.`;

  // Only OWNERs can grant OWNER role
  if (role === "OWNER" && guard.ctx.role !== "OWNER") {
    return NextResponse.json(
      { error: "Only an OWNER can grant the OWNER role." },
      { status: 403 }
    );
  }

  if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 422 });

  // Verify target user exists
  const targetUser = await prisma.user.findUnique({
    where: { id: userId as string },
    select: { id: true, name: true, email: true },
  });
  if (!targetUser) return NextResponse.json({ error: "User not found." }, { status: 404 });

  // Prevent duplicate membership
  const existing = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: userId as string } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "User is already a member of this organization." },
      { status: 409 }
    );
  }

  const member = await prisma.organizationMember.create({
    data: { organizationId, userId: userId as string, role: role as MemberRole },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  });

  return NextResponse.json({ member }, { status: 201 });
}
