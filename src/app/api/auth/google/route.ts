// Initiates Supabase Auth's Google OAuth flow (spec section 2: "Supabase
// Auth, Google SSO only"). Documented @supabase/ssr API
// (signInWithOAuth({ provider: 'google' })); unverified against a live
// Supabase project in this sandbox -- see README.
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/auth/supabase";

export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const redirectTo = new URL("/api/auth/callback", request.url).toString();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });

  if (error || !data.url) {
    return NextResponse.json({ error: error?.message ?? "failed to start Google sign-in" }, { status: 500 });
  }

  return NextResponse.redirect(data.url);
}
