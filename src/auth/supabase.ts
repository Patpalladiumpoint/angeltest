// Supabase Auth, Google SSO only (spec section 2). Server-side client per
// the documented @supabase/ssr Next.js App Router pattern -- cookies carry
// the session, this client reads/writes them through Next's cookies() API.
// Unverified against a live Supabase project in this sandbox (no network
// access to provision one -- see README "A note on this session's
// constraints"); written to the documented API, not guessed at.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: Record<string, unknown>) {
        try {
          cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies() is read-only --
          // the middleware (middleware.ts) is what actually refreshes the
          // session cookie on those requests. Safe to ignore here.
        }
      },
      remove(name: string, options: Record<string, unknown>) {
        try {
          cookieStore.set(name, "", { ...options, maxAge: 0 });
        } catch {
          // See set() above.
        }
      },
    },
  });
}
