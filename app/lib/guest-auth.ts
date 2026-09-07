import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { decrypt } from "@/app/lib/session";
import { prisma } from "@/src/lib/prisma";

// ---------------------------------------------------------------------------
// GuestAuthContext
//
// Guests authenticate as regular Users (no separate credential system).
// After verifying the session we return the userId so route handlers can
// look up or create Guest CRM records scoped to specific organizations.
// ---------------------------------------------------------------------------

export type GuestAuthContext = {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
};

/**
 * Validates the session cookie and returns the authenticated user's basic
 * info. Returns a 401 NextResponse if unauthenticated or user not found.
 */
export async function requireGuestAuth(): Promise<
  | { ok: true; user: GuestAuthContext }
  | { ok: false; response: NextResponse }
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

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, phone: true },
  });

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "User account not found." },
        { status: 401 }
      ),
    };
  }

  return {
    ok: true,
    user: { userId: user.id, name: user.name, email: user.email, phone: user.phone },
  };
}

/**
 * Finds or creates an org-scoped Guest CRM record for the authenticated user.
 * Called when a guest makes a booking so the Reservation can link to a Guest id.
 */
export async function findOrCreateGuest(
  organizationId: string,
  user: GuestAuthContext
): Promise<string> {
  const existing = await prisma.guest.findUnique({
    where: {
      organizationId_email: { organizationId, email: user.email },
    },
    select: { id: true },
  });

  if (existing) return existing.id;

  // Split name into first/last (best-effort)
  const parts = user.name.trim().split(/\s+/);
  const firstName = parts[0] ?? user.name;
  const lastName = parts.slice(1).join(" ") || "-";

  const created = await prisma.guest.create({
    data: {
      organizationId,
      firstName,
      lastName,
      email: user.email,
      phone: user.phone,
    },
    select: { id: true },
  });

  return created.id;
}
