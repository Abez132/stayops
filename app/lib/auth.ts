import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { decrypt } from "@/app/lib/session";
import { prisma } from "@/src/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemberRole = "OWNER" | "MANAGER" | "CLEANER" | "MAINTENANCE";

export type AuthContext = {
  userId: string;
};

export type OrgAuthContext = {
  userId: string;
  memberId: string;
  role: MemberRole;
  organizationId: string;
};

// Role hierarchy — each role implicitly includes the ones below it
const ROLE_RANK: Record<MemberRole, number> = {
  OWNER: 4,
  MANAGER: 3,
  CLEANER: 2,
  MAINTENANCE: 1,
};

export function hasMinRole(actual: MemberRole, minimum: MemberRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[minimum];
}

// ---------------------------------------------------------------------------
// requireAuth
//
// Validates the session cookie and returns the userId.
// Returns a 401 NextResponse if unauthenticated.
// ---------------------------------------------------------------------------

export async function requireAuth(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  const session = await decrypt(token);

  if (!session?.userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      ),
    };
  }

  return { ok: true, userId: session.userId };
}

// ---------------------------------------------------------------------------
// requireOrgRole
//
// Validates the session AND checks that the user is a member of the given
// organization with at least `minimumRole`.
//
// Returns a 401/403/404 NextResponse on failure, or the membership context.
// ---------------------------------------------------------------------------

export async function requireOrgRole(
  organizationId: string,
  minimumRole: MemberRole = "MAINTENANCE"
): Promise<{ ok: true; ctx: OrgAuthContext } | { ok: false; response: NextResponse }> {
  const auth = await requireAuth();
  if (!auth.ok) return auth;

  const member = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: auth.userId,
      },
    },
    select: { id: true, role: true, organizationId: true },
  });

  if (!member) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Organization not found or access denied." },
        { status: 404 }
      ),
    };
  }

  if (!hasMinRole(member.role as MemberRole, minimumRole)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Insufficient permissions. Required role: ${minimumRole}.`,
        },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    ctx: {
      userId: auth.userId,
      memberId: member.id,
      role: member.role as MemberRole,
      organizationId: member.organizationId,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Slugify a string for use as a URL-safe identifier */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Parse a JSON body safely; returns null on failure */
export async function parseBody<T = Record<string, unknown>>(
  request: Request
): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
