"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

// Only ever shows the provider actually configured for this environment
// (see src/auth/config.ts) -- there is no local-password fallback to offer.
// The dev picker below is additionally gated server-side to non-production;
// it's shown unconditionally here purely as a dev convenience -- signing in
// through it against a production auth config would just fail server-side.
export default function SignInPage() {
  const [email, setEmail] = useState("");

  return (
    <main>
      <h1>Sign in</h1>
      <p>Sign in with your Palladium Point Workspace or Microsoft 365 account.</p>
      <button onClick={() => signIn("google")}>Sign in with Google</button>
      <button onClick={() => signIn("azure-ad")}>Sign in with Microsoft</button>

      {process.env.NODE_ENV !== "production" && (
        <section style={{ marginTop: "2rem", borderTop: "1px solid #ccc", paddingTop: "1rem" }}>
          <h2>Dev sign-in</h2>
          <p>Local development only. Picks a seeded user by email, no password.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void signIn("dev-picker", { email, callbackUrl: "/" });
            }}
          >
            <input
              type="email"
              placeholder="you@palladiumpoint.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit">Continue</button>
          </form>
        </section>
      )}
    </main>
  );
}
