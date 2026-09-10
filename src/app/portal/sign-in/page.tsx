import { portalSignIn } from "./actions";

// Client portal sign-in. Deliberately separate from /sign-in (internal
// app) -- see src/portal/session.ts for why these are two identity spaces,
// and its SECURITY NOTE before treating this as production-ready.
export default function PortalSignInPage() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 400, width: "100%", padding: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: "1px solid var(--line-strong)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "Fraunces, serif",
              fontSize: 15,
            }}
          >
            P
          </div>
          <div>
            <div style={{ fontFamily: "Fraunces, serif", fontSize: 16, fontWeight: 600 }}>Palladium Point</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.06em" }}>
              CLIENT PORTAL
            </div>
          </div>
        </div>

        <form action={portalSignIn}>
          <label htmlFor="portal-email" style={{ display: "block", fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 6 }}>
            Email
          </label>
          <input id="portal-email" name="email" type="email" placeholder="you@yourbrokerage.com" required className="field" />
          <button type="submit" className="btn btn-primary" style={{ marginTop: 14, width: "100%", justifyContent: "center" }}>
            Sign In
          </button>
        </form>

        <p style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 20, lineHeight: 1.5 }}>
          Demo sign-in — enter the email address Palladium Point set up for your account. A real deploy replaces this with a
          verified sign-in link.
        </p>
      </div>
    </main>
  );
}
