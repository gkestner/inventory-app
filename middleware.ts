
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

function isPublicPath(pathname: string) {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/api/integrations/mocreo/sync")) return true;
  if (pathname.startsWith("/api/integrations/mocreo/webhook")) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/robots.txt") return true;
  if (pathname === "/sitemap.xml") return true;
  return false;
}

function isStaleSyncAuthReason(reason: string): boolean {
  const value = reason.toLowerCase();
  return (
    value.includes("authentication required") ||
    value.includes("llms.txt") ||
    value.includes("<!doctype html") ||
    value.includes("<html")
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/maintenance/temperature-dashboard") {
    const code = req.nextUrl.searchParams.get("code")?.trim() ?? "";
    const reason = req.nextUrl.searchParams.get("reason")?.trim() ?? "";
    if (code === "401" && reason && isStaleSyncAuthReason(reason)) {
      const cleanUrl = req.nextUrl.clone();
      cleanUrl.searchParams.set(
        "reason",
        "Stale app session detected. Close and reopen the app (or hard refresh browser) and run Sync Now again."
      );
      return NextResponse.redirect(cleanUrl);
    }
  }

  const token = await getToken({ req });

  // Keep /login reachable even when authenticated.
  // This prevents redirect loops for users whose role/permissions
  // no longer resolve to a landing page, and allows account switching.
  if (pathname === "/login") {
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // NOTE:
  // Do not enforce role-only /admin checks in middleware.
  // Admin access is resolved server-side using permission-based guards.
  // A strict Role.ADMIN middleware gate can cause redirect loops when
  // users have admin permissions via titles but non-ADMIN legacy roles.

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
