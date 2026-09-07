import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/src/lib/prisma";
import { createSession } from "@/app/lib/session";

// ---------------------------------------------------------------------------
// POST /api/auth/login
//
// Body: { email, password }
// Verifies credentials and issues a session cookie on success.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { email, password } = body as Record<string, unknown>;

  // ── Basic validation ─────────────────────────────────────────────────────

  if (!email || typeof email !== "string") {
    return NextResponse.json(
      { error: "Email is required." },
      { status: 422 }
    );
  }

  if (!password || typeof password !== "string") {
    return NextResponse.json(
      { error: "Password is required." },
      { status: 422 }
    );
  }

  // ── Look up user ──────────────────────────────────────────────────────────

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      passwordHash: true,
      createdAt: true,
    },
  });

  // Use a constant-time comparison even for the "not found" case to prevent
  // user enumeration via timing attacks.
  const dummyHash =
    "$2b$12$invalidhashpaddingthatisusedtopreventimenumerationaaaaaaa";

  const passwordMatch = await bcrypt.compare(
    password,
    user?.passwordHash ?? dummyHash
  );

  if (!user || !passwordMatch) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  // ── Issue session ─────────────────────────────────────────────────────────

  await createSession(user.id);

  // Never return passwordHash to the client
  const { passwordHash: _, ...safeUser } = user;

  return NextResponse.json(
    { message: "Logged in successfully.", user: safeUser },
    { status: 200 }
  );
}
