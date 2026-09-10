-- Client portal (not part of spec section 3 -- the v3.0 spec has no client-
-- facing surface at all; this is additive product work). client_contact is
-- a distinct identity space from app_user on purpose: a client contact is
-- never a recruiter/ops/exec and must never be reachable through the
-- internal app's session or role system. Scoping is enforced at the query
-- layer (src/portal/queries.ts never joins outside client_contact.client_id)
-- and, for the money columns specifically, for free: client_contract.fee_percent,
-- job.fee_override, and person_employment.comp already have table-level
-- SELECT revoked from palladium_app (migrations/0007) regardless of which
-- actor context is asking, so a portal query bug can't leak them even if it
-- tried.

CREATE TABLE IF NOT EXISTS client_contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES client(id),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_contact_client_idx ON client_contact (client_id);

GRANT SELECT, INSERT, UPDATE ON client_contact TO palladium_app;
