import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { prisma } from "@/src/lib/prisma";

// ---------------------------------------------------------------------------
// verifySession
//
// Reads and validates the session cookie. Returns the session payload if
// valid, redirects to /login if not. Memoised with React cache() so
// multiple callers in the same render tree only pay the cost once.
// ---------------------------------------------------------------------------

export const verifySession = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  const session = await decrypt(token);

  if (!session?.userId) {
    redirect("/login");
  }

  return { isAuth: true, userId: session.userId };
});

// ---------------------------------------------------------------------------
// getUser
//
// Returns the authenticated user's safe fields (no passwordHash).
// Relies on verifySession so it also redirects if unauthenticated.
// ---------------------------------------------------------------------------

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: Date;
  memberships: {
    id: string;
    role: string;
    organizationId: string;
    organization: { id: string; name: string; slug: string };
  }[];
};

export const getUser = cache(async (): Promise<SafeUser> => {
  const { userId } = await verifySession();

  const user = await prisma.user.findUnique({
    where: { id: userId },
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
    redirect("/login");
  }

  return user;
});
