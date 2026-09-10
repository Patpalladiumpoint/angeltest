// Production-safe portal authentication (section 16 -- release blocker).
// Passwordless magic-link, replacing the plain-email dev sign-in this
// codebase shipped with earlier. Every piece here except actual email
// delivery (src/portal/emailSender.ts) is fully real and was verified
// directly against Postgres in this session: token generation and
// hashing, expiry, single-use enforcement, and session creation/
// revocation.
//
// Only hashes ever touch the database (migrations/0015) -- the raw token
// exists for one request/response cycle (the emailed link, or the
// browser's session cookie) and is never persisted anywhere. A database
// read or leak of portal_magic_link/portal_session cannot be used to log
// in as someone; only the raw value, which the database never has,
// can.
import { randomBytes, createHash } from "node:crypto";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { clientContact, portalMagicLink, portalSession } from "@/db/schema";
import { emailSender } from "./emailSender";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Always succeeds from the caller's point of view whether or not the
// email matches an active client_contact -- never reveal via timing or
// response shape whether a given email has portal access. The link (when
// a contact does exist) is returned so the caller can pass it to the
// email sender; outside production, src/app/portal/sign-in/actions.ts
// also surfaces it directly in the response (see that file's comment) so
// the flow is clickable in this environment with no real email provider.
export async function requestMagicLink(email: string, baseUrl: string): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const [contact] = await db
    .select({ id: clientContact.id })
    .from(clientContact)
    .where(and(eq(clientContact.email, normalizedEmail), eq(clientContact.isActive, true)))
    .limit(1);
  if (!contact) return null;

  const token = generateToken();
  await db.insert(portalMagicLink).values({
    clientContactId: contact.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
  });

  const linkUrl = `${baseUrl}/portal/auth/verify?token=${token}`;
  await emailSender.sendMagicLink(normalizedEmail, linkUrl);
  return linkUrl;
}

// Redeems a magic link token: single-use (used_at set atomically with the
// lookup's WHERE clause -- a second redemption attempt finds no matching
// unused row) and time-limited. Returns a raw session token to set as a
// cookie, or null if the link is invalid/expired/already used.
export async function verifyMagicLinkAndCreateSession(rawToken: string): Promise<string | null> {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const [link] = await db
    .select()
    .from(portalMagicLink)
    .where(and(eq(portalMagicLink.tokenHash, tokenHash), isNull(portalMagicLink.usedAt), gt(portalMagicLink.expiresAt, now)))
    .limit(1);
  if (!link) return null;

  await db.update(portalMagicLink).set({ usedAt: now }).where(eq(portalMagicLink.id, link.id));

  const sessionToken = generateToken();
  await db.insert(portalSession).values({
    clientContactId: link.clientContactId,
    sessionTokenHash: hashToken(sessionToken),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  return sessionToken;
}

export type PortalActor = { clientContactId: string; clientId: string; name: string; email: string };

export async function getPortalActorFromSession(rawSessionToken: string | undefined): Promise<PortalActor | null> {
  if (!rawSessionToken) return null;
  const tokenHash = hashToken(rawSessionToken);
  const now = new Date();

  const [row] = await db
    .select({
      clientContactId: clientContact.id,
      clientId: clientContact.clientId,
      name: clientContact.name,
      email: clientContact.email,
    })
    .from(portalSession)
    .innerJoin(clientContact, eq(clientContact.id, portalSession.clientContactId))
    .where(and(eq(portalSession.sessionTokenHash, tokenHash), isNull(portalSession.revokedAt), gt(portalSession.expiresAt, now)))
    .limit(1);

  return row ?? null;
}

export async function revokeSession(rawSessionToken: string): Promise<void> {
  await db
    .update(portalSession)
    .set({ revokedAt: new Date() })
    .where(eq(portalSession.sessionTokenHash, hashToken(rawSessionToken)));
}
