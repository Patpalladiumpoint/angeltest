// Client portal session -- now backed by src/portal/auth.ts's real,
// verified magic-link + revocable-session system (migrations/0015),
// replacing the plain-email dev cookie this file used to hold. A
// separate cookie name and a separate identity space from the internal
// app's getCurrentActor() (src/auth/session.ts) on purpose: a client
// contact must never be reachable through the internal session, and vice
// versa.
import { cookies } from "next/headers";
import { getPortalActorFromSession, type PortalActor } from "./auth";

const PORTAL_SESSION_COOKIE = "palladium_portal_session";

export async function getPortalActor(): Promise<PortalActor | null> {
  const token = cookies().get(PORTAL_SESSION_COOKIE)?.value;
  return getPortalActorFromSession(token);
}

export { PORTAL_SESSION_COOKIE };
export type { PortalActor };
