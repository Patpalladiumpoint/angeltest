// Redeems a magic link token (src/portal/auth.ts) and establishes a real
// session cookie. GET because this is what the emailed link itself is --
// a normal clicked URL, not a form submission. The token is single-use
// (verifyMagicLinkAndCreateSession marks it used atomically with the
// lookup), so reloading this page after the first successful visit
// correctly fails and sends the visitor back to sign in again.
import { NextResponse, type NextRequest } from "next/server";
import { verifyMagicLinkAndCreateSession } from "@/portal/auth";
import { PORTAL_SESSION_COOKIE } from "@/portal/session";

const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days, matches SESSION_TTL_MS in auth.ts

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/portal/sign-in?error=missing_token", request.url));
  }

  const sessionToken = await verifyMagicLinkAndCreateSession(token);
  if (!sessionToken) {
    return NextResponse.redirect(new URL("/portal/sign-in?error=invalid_or_expired", request.url));
  }

  const response = NextResponse.redirect(new URL("/portal", request.url));
  response.cookies.set(PORTAL_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
