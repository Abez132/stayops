import { NextResponse } from "next/server";
import { deleteSession } from "@/app/lib/session";

// ---------------------------------------------------------------------------
// POST /api/auth/logout
//
// Clears the session cookie. Always succeeds — idempotent.
// ---------------------------------------------------------------------------

export async function POST() {
  await deleteSession();

  return NextResponse.json(
    { message: "Logged out successfully." },
    { status: 200 }
  );
}
