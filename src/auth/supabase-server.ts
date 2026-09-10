import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// Server-side Supabase client for Server Components/Actions/Route Handlers.
// Spec section 2: "Auth: Supabase Auth, Google SSO only." This file only
// wraps session/cookie plumbing -- role lookup lives in src/auth/session.ts
// against our own users table, not Supabase's auth.users.
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. " +
        "See .env.example and the README's 'Running locally' section.",
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Called from a Server Component -- the middleware refreshes the
          // session cookie instead. Safe to ignore (standard @supabase/ssr
          // pattern for the Next.js App Router).
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // See set() above.
        }
      },
    },
  });
}
