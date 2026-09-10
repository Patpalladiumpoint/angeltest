// OAuth callback (documented @supabase/ssr pattern): exchanges the ?code
// param for a session, which the server client writes to cookies. If the
// signed-in Google account has no matching app_user row, this is an
// unprovisioned user -- section 8's three roles are assigned by an admin
// seeding app_user, not by signing in, so send them to an explanatory page
// rather than into the app with no role.
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createSupabaseServerClient } from "@/auth/supabase";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/sign-in?error=missing_code", request.url));
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(`/sign-in?error=${encodeURIComponent(error.message)}`, request.url));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email) {
    const [existing] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, user.email)).limit(1);
    if (existing) {
      // Link auth_user_id on first sign-in so future lookups don't depend
      // on email staying stable.
      await db.update(appUser).set({ authUserId: user.id }).where(eq(appUser.id, existing.id));
    } else {
      return NextResponse.redirect(new URL("/sign-in?error=no_app_user_provisioned", request.url));
    }
  }

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
