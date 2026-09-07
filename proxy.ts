import { type NextRequest, NextResponse } from "next/server";
import { decrypt } from "@/app/lib/session";
import { cookies } from "next/headers";

// ---------------------------------------------------------------------------
// Routes that require the user to be authenticated
// ---------------------------------------------------------------------------
const protectedRoutes = ["/dashboard"];

// ---------------------------------------------------------------------------
// Routes that authenticated users should be bounced away from
// ---------------------------------------------------------------------------
const authRoutes = ["/login", "/register"];

// ---------------------------------------------------------------------------
// proxy (replaces middleware in Next.js 16)
//
// Performs an optimistic auth check on every matched request:
//  - Unauthenticated access to a protected route → redirect to /login
//  - Authenticated access to an auth route (login/register) → redirect to /dashboard
// ---------------------------------------------------------------------------

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  // Only read the cookie when we actually need it
  if (!isProtectedRoute && !isAuthRoute) {
    return NextResponse.next();
  }

  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  const session = await decrypt(token);
  const isAuthenticated = Boolean(session?.userId);

  if (isProtectedRoute && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    // Preserve the intended destination so we can redirect after login
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthRoute && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     *  - _next/static  (static assets)
     *  - _next/image   (image optimisation)
     *  - favicon.ico
     *  - public files (png, jpg, svg, etc.)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)",
  ],
};
