import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { prisma } from "@/src/lib/prisma";
import { updateSession } from "@/app/lib/session";

// ---------------------------------------------------------------------------
// GET /api/auth/session
//
// Returns the current session's user (safe fields) or 401 if unauthenticated.
// Also refreshes (slides) the session expiry on each successful call.
// ---------------------------------------------------------------------------

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  const session = await decrypt(token);

  if (!session?.userId) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
      memberships: {
        select: {
          id: true,
          role: true,
          organizationId: true,
          organization: {
            select: { id: true, name: true, slug: true },
          },
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json(
      { error: "User no longer exists." },
      { status: 401 }
    );
  }

  // Slide expiry forward while the user is active
  await updateSession();

  return NextResponse.json(
    {
      user,
      expiresAt: session.expiresAt,
    },
    { status: 200 }
  );
}
