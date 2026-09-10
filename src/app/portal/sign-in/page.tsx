import { requestMagicLinkAction } from "./actions";

// Client portal sign-in -- passwordless magic link (src/portal/auth.ts).
// Replaces the old plain-email dev cookie entirely; see that file's
// header comment for what's real here (the whole token/session
// lifecycle) versus what isn't (actual email delivery -- no provider is
// configured in this sandbox, so the link is logged server-side and, in
// dev only, shown directly below).
export default function PortalSignInPage({
  searchParams,
}: {
  searchParams: { sent?: string; devLink?: string; error?: string };
}) {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 420, width: "100%", padding: 32 }}>
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

        {searchParams.error && (
          <div className="pill pill-rust" style={{ marginBottom: 16 }}>
            {searchParams.error === "invalid_or_expired" ? "That link has expired or was already used." : "Something went wrong."}
          </div>
        )}

        {searchParams.sent ? (
          <div>
            <p style={{ fontSize: 14, color: "var(--ink-muted)", lineHeight: 1.6 }}>
              If that email has portal access, a sign-in link is on its way. Check your inbox — the link expires in 15 minutes.
            </p>
            {searchParams.devLink && (
              <div style={{ marginTop: 16, padding: 14, background: "var(--surface-sunk)", borderRadius: 4 }}>
                <p style={{ fontSize: 11.5, color: "var(--ink-faint)", margin: "0 0 8px" }}>
                  DEV ONLY — no email provider is configured in this environment (see src/portal/emailSender.ts). This link would
                  normally only exist in the email:
                </p>
                <a href={searchParams.devLink} className="btn btn-primary" style={{ wordBreak: "break-all", fontSize: 11 }}>
                  {searchParams.devLink}
                </a>
              </div>
            )}
            <a href="/portal/sign-in" style={{ display: "block", marginTop: 16, fontSize: 13, color: "var(--ink-faint)" }}>
              ← Try a different email
            </a>
          </div>
        ) : (
          <form action={requestMagicLinkAction}>
            <label htmlFor="portal-email" style={{ display: "block", fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 6 }}>
              Email
            </label>
            <input id="portal-email" name="email" type="email" placeholder="you@yourbrokerage.com" required className="field" />
            <button type="submit" className="btn btn-primary" style={{ marginTop: 14, width: "100%", justifyContent: "center" }}>
              Send Sign-In Link
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
