"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requestMagicLink, revokeSession } from "@/portal/auth";
import { PORTAL_SESSION_COOKIE } from "@/portal/session";

// Requests a magic link (src/portal/auth.ts -- real token generation,
// hashing, and 15-minute expiry, verified against Postgres). Redirects
// back to the sign-in page with ?sent=1 either way -- never reveal via
// the response whether a given email has portal access (requestMagicLink
// itself already returns the same "success" shape regardless).
//
// Outside production, the redirect also carries ?devLink=... so the
// sign-in page can render it as a clickable link. There is no real email
// provider configured in this environment (see src/portal/emailSender.ts,
// which only logs the link server-side) -- hiding it here would make the
// whole flow untestable rather than actually more secure, since the link
// is already sitting in the server console either way. This dev-only
// surfacing must be REMOVED, not just gated harder, once a real provider
// is wired -- see docs/manual-steps.md.
export async function requestMagicLinkAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const host = headers().get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const linkUrl = await requestMagicLink(email, baseUrl);

  const params = new URLSearchParams({ sent: "1" });
  if (process.env.NODE_ENV !== "production" && linkUrl) {
    params.set("devLink", linkUrl);
  }
  redirect(`/portal/sign-in?${params.toString()}`);
}

export async function portalSignOut(): Promise<void> {
  const token = cookies().get(PORTAL_SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  cookies().delete(PORTAL_SESSION_COOKIE);
  redirect("/portal/sign-in");
}
