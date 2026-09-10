// Client portal session. Deliberately a SEPARATE identity space and cookie
// from src/auth/session.ts's internal getCurrentActor() -- a client contact
// must never be reachable through the internal app's session, and vice
// versa. See db/migrations/0009_client_contact.sql.
//
// SECURITY NOTE, read before deploying this anywhere real: this is
// dev/demo-only email sign-in (same NODE_ENV !== "production" gate as the
// internal app's dev sign-in, src/auth/session.ts), but the internal app
// has a real fallback (Supabase Auth Google SSO) for production. The
// client portal does not yet -- there is no verification step here at
// all, just "type a known client_contact email." That is acceptable for
// internal testing and is NOT acceptable for real clients: wire Supabase
// Auth magic-link (or another verified channel) to client_contact.email
// before any external client ever sees a URL to this portal.
import { cookies } from "next/headers";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { clientContact } from "@/db/schema";

const PORTAL_SESSION_COOKIE = "palladium_portal_email";

export type PortalActor = { clientContactId: string; clientId: string; name: string; email: string };

export async function getPortalActor(): Promise<PortalActor | null> {
  const email = cookies().get(PORTAL_SESSION_COOKIE)?.value;
  if (!email) return null;

  const [contact] = await db
    .select()
    .from(clientContact)
    .where(and(eq(clientContact.email, email), eq(clientContact.isActive, true)))
    .limit(1);
  if (!contact) return null;

  return { clientContactId: contact.id, clientId: contact.clientId, name: contact.name, email: contact.email };
}

export { PORTAL_SESSION_COOKIE };
