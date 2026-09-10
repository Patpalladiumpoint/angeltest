"use client";

import { createSupabaseBrowserClient } from "@/auth/supabase-browser";

// Google SSO only (spec section 2, OQ 7 defaulted to Google Workspace).
// There is no local-password fallback and no dev bypass here: Supabase
// Auth's own local dev stack (`supabase start`, via the Supabase CLI) is
// the honest local-dev equivalent -- a real GoTrue auth server running
// locally, not an app-code shortcut around SSO. See README "Running
// locally."
export default function SignInPage() {
  async function signInWithGoogle() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Restricts at the IdP level to the firm's Workspace domain (OQ 7).
        // Re-checked nowhere server-side today because Phase 0 has no
        // self-serve signup: an unprovisioned account simply isn't in the
        // users table and getCurrentUser() returns null regardless of
        // which Google account authenticated.
        queryParams: process.env.NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN
          ? { hd: process.env.NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN }
          : {},
      },
    });
  }

  return (
    <main>
      <h1>Palladium OS</h1>
      <p>Sign in with your Palladium Point Google account.</p>
      <button onClick={signInWithGoogle}>Sign in with Google</button>
    </main>
  );
}
