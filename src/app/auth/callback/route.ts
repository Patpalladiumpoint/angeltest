import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/auth/supabase-server";

// OAuth redirect target registered with Supabase/Google. Exchanges the
// auth code for a session cookie, then hands off to the app -- role
// provisioning happens on the next request via getCurrentUser().
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (code) {
    const supabase = createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL("/", request.url));
}
