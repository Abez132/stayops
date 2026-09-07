import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/src/lib/prisma";
import { createSession } from "@/app/lib/session";

// ---------------------------------------------------------------------------
// POST /api/auth/register
//
// Body: { name, email, password, phone? }
// Creates a new user account and immediately issues a session cookie.
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

  const { name, email, password, phone } = body as Record<string, unknown>;

  // ── Validation ──────────────────────────────────────────────────────────

  const errors: Record<string, string> = {};

  if (!name || typeof name !== "string" || name.trim().length < 2) {
    errors.name = "Name must be at least 2 characters.";
  }

  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "A valid email address is required.";
  }

  if (
    !password ||
    typeof password !== "string" ||
    password.length < 8 ||
    !/[a-zA-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    errors.password =
      "Password must be at least 8 characters and contain a letter and a number.";
  }

  if (phone !== undefined && phone !== null && typeof phone !== "string") {
    errors.phone = "Phone must be a string.";
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 });
  }

  // ── Uniqueness check ─────────────────────────────────────────────────────

  const existing = await prisma.user.findUnique({
    where: { email: (email as string).toLowerCase().trim() },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  // ── Create user ───────────────────────────────────────────────────────────

  const passwordHash = await bcrypt.hash(password as string, 12);

  const user = await prisma.user.create({
    data: {
      name: (name as string).trim(),
      email: (email as string).toLowerCase().trim(),
      passwordHash,
      phone: phone ? (phone as string).trim() : null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
    },
  });

  // ── Issue session ─────────────────────────────────────────────────────────

  await createSession(user.id);

  return NextResponse.json(
    { message: "Account created successfully.", user },
    { status: 201 }
  );
}
