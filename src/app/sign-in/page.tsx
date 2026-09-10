import { devSignIn } from "./actions";

export default function SignInPage() {
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

  return (
    <main style={{ maxWidth: 420, margin: "80px auto", padding: 24 }}>
      <h1>Palladium OS</h1>

      {supabaseConfigured ? (
        <a
          href="/api/auth/google"
          style={{ display: "inline-block", padding: "10px 16px", background: "#111", color: "#fff", borderRadius: 6 }}
        >
          Sign in with Google
        </a>
      ) : (
        <p style={{ color: "#a00" }}>
          NEXT_PUBLIC_SUPABASE_URL is not set -- Google SSO is unavailable. Use dev sign-in below (NODE_ENV !==
          &quot;production&quot; only).
        </p>
      )}

      {process.env.NODE_ENV !== "production" && (
        <form action={devSignIn} style={{ marginTop: 24, border: "1px solid #ddd", padding: 16, borderRadius: 6 }}>
          <p style={{ marginTop: 0, fontSize: 13, color: "#555" }}>
            Dev sign-in: email of a seeded app_user (npm run db:seed). No password -- not a real auth path, see
            src/auth/session.ts.
          </p>
          <input name="email" type="email" placeholder="you@palladiumpoint.com" required style={{ width: "100%", padding: 8 }} />
          <button type="submit" style={{ marginTop: 8, padding: "8px 16px" }}>
            Continue
          </button>
        </form>
      )}
    </main>
  );
}
