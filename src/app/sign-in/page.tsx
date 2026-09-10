"use client";

import { signIn } from "next-auth/react";

// Only ever shows the provider actually configured for this environment
// (see src/auth/config.ts) -- there is no local-password fallback to offer.
export default function SignInPage() {
  return (
    <main>
      <h1>Sign in</h1>
      <p>Sign in with your Palladium Point Workspace or Microsoft 365 account.</p>
      <button onClick={() => signIn("google")}>Sign in with Google</button>
      <button onClick={() => signIn("azure-ad")}>Sign in with Microsoft</button>
    </main>
  );
}
