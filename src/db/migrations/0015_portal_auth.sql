-- Production-safe portal authentication (section 16 -- release blocker).
-- Passwordless magic-link: a client_contact requests a link, gets a
-- single-use token good for a short window, and redeeming it establishes
-- a real, server-side, revocable session -- not a bare cookie holding an
-- email address (the old dev-only mechanism, src/portal/session.ts,
-- documented there as explicitly not production-safe).
--
-- Only the token/session HASH is ever stored -- the raw token exists only
-- in the emailed link and the browser's session cookie, never in the
-- database, so a database read (or leak) can't be used to log in as
-- someone. See src/portal/auth.ts for the generation/verification code
-- this schema backs.

CREATE TABLE IF NOT EXISTS portal_magic_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_contact_id uuid NOT NULL REFERENCES client_contact(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_magic_link_contact_idx ON portal_magic_link (client_contact_id);
-- Redeeming a link is a lookup by hash then a check of used_at/expires_at
-- in the same query -- see src/portal/auth.ts's verifyMagicLink().

CREATE TABLE IF NOT EXISTS portal_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_contact_id uuid NOT NULL REFERENCES client_contact(id),
  session_token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS portal_session_contact_idx ON portal_session (client_contact_id);

GRANT SELECT, INSERT, UPDATE ON portal_magic_link, portal_session TO palladium_app;
