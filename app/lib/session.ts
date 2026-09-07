import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionPayload = {
  userId: string;
  expiresAt: Date;
};

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function getEncodedKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is not set.");
  }
  return new TextEncoder().encode(secret);
}

export async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(payload.expiresAt)
    .sign(getEncodedKey());
}

export async function decrypt(
  token: string | undefined
): Promise<SessionPayload | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getEncodedKey(), {
      algorithms: ["HS256"],
    });

    return {
      userId: payload.userId as string,
      expiresAt: new Date((payload.exp as number) * 1000),
    };
  } catch {
    // Token is expired, tampered, or otherwise invalid
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookie management
// ---------------------------------------------------------------------------

const COOKIE_NAME = "session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function createSession(userId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const token = await encrypt({ userId, expiresAt });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export async function updateSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = await decrypt(token);

  if (!token || !session) return;

  // Slide the expiry window forward on each active request
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const refreshed = await encrypt({ userId: session.userId, expiresAt });

  cookieStore.set(COOKIE_NAME, refreshed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
