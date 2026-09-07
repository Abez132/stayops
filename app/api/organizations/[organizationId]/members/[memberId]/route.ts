import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireOrgRole, parseBody, type MemberRole } from "@/app/lib/auth";

type RouteContext = { params: Promise<{ organizationId: string; memberId: string }> };

const VALID_ROLES: MemberRole[] = ["OWNER", "MANAGER", "CLEANER", "MAINTENANCE"];

async function getMemberInOrg(organizationId: string, memberId: string) {
  return prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId },
    select: {
      id: true,
      role: true,
      createdAt: true,
      userId: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/organizations/:organizationId/members/:memberId
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, memberId } = await params;

  const guard = await requireOrgRole(organizationId, "MAINTENANCE");
  if (!guard.ok) return guard.response;

  const member = await getMemberInOrg(organizationId, memberId);
  if (!member) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  return NextResponse.json({ member });
}

// ---------------------------------------------------------------------------
// PATCH /api/organizations/:organizationId/members/:memberId
// Change a member's role. Requires MANAGER+.
// Body: { role }
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { organizationId, memberId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const body = await parseBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const { role } = body as Record<string, unknown>;

  if (!role || !VALID_ROLES.includes(role as MemberRole)) {
    return NextResponse.json(
      { error: `role must be one of: ${VALID_ROLES.join(", ")}.` },
      { status: 422 }
    );
  }

  // Only OWNERs can grant or change to OWNER role
  if (role === "OWNER" && guard.ctx.role !== "OWNER") {
    return NextResponse.json(
      { error: "Only an OWNER can grant the OWNER role." },
      { status: 403 }
    );
  }

  const target = await getMemberInOrg(organizationId, memberId);
  if (!target) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  // Prevent demoting the last OWNER
  if (target.role === "OWNER" && role !== "OWNER") {
    const ownerCount = await prisma.organizationMember.count({
      where: { organizationId, role: "OWNER" },
    });
    if (ownerCount <= 1) {
      return NextResponse.json(
        { error: "Cannot change role: organization must have at least one OWNER." },
        { status: 409 }
      );
    }
  }

  const member = await prisma.organizationMember.update({
    where: { id: memberId },
    data: { role: role as MemberRole },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  });

  return NextResponse.json({ member });
}

// ---------------------------------------------------------------------------
// DELETE /api/organizations/:organizationId/members/:memberId
// Remove a member. Requires MANAGER+ (OWNER to remove another OWNER).
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { organizationId, memberId } = await params;

  const guard = await requireOrgRole(organizationId, "MANAGER");
  if (!guard.ok) return guard.response;

  const target = await getMemberInOrg(organizationId, memberId);
  if (!target) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  // Only an OWNER can remove another OWNER
  if (target.role === "OWNER" && guard.ctx.role !== "OWNER") {
    return NextResponse.json(
      { error: "Only an OWNER can remove another OWNER." },
      { status: 403 }
    );
  }

  // Prevent removing the last OWNER
  if (target.role === "OWNER") {
    const ownerCount = await prisma.organizationMember.count({
      where: { organizationId, role: "OWNER" },
    });
    if (ownerCount <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last OWNER of an organization." },
        { status: 409 }
      );
    }
  }

  await prisma.organizationMember.delete({ where: { id: memberId } });

  return NextResponse.json({ message: "Member removed." });
}
