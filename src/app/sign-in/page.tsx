import { devSignIn } from "./actions";

export default function SignInPage() {
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 400, width: "100%", padding: 32 }}>
        <div style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600 }}>Palladium OS</div>
        <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.12em", color: "var(--ink-faint)", marginTop: 2, marginBottom: 28 }}>
          PALLADIUM POINT
        </div>

        {supabaseConfigured ? (
          <a className="btn btn-primary" href="/api/auth/google" style={{ width: "100%", justifyContent: "center" }}>
            Sign in with Google
          </a>
        ) : (
          <p style={{ fontSize: 13, color: "var(--rust)", lineHeight: 1.5 }}>
            NEXT_PUBLIC_SUPABASE_URL is not set — Google SSO is unavailable. Use dev sign-in below (non-production only).
          </p>
        )}

        {process.env.NODE_ENV !== "production" && (
          <form action={devSignIn} style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--line)" }}>
            <p style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
              Dev sign-in: email of a seeded app_user (npm run db:seed). No password — see src/auth/session.ts.
            </p>
            <input name="email" type="email" placeholder="you@palladiumpoint.com" required className="field" />
            <button type="submit" className="btn btn-primary" style={{ marginTop: 12, width: "100%", justifyContent: "center" }}>
              Continue
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
