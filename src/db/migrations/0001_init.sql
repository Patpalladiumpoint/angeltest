-- Phase 0 foundation: organization singleton, users, feature flags, and the
-- append-only audit log. Run by the migrations role (schema owner), never by
-- the app role.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('recruiter', 'ops', 'exec');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Spec 3.1: "organization (Palladium itself, single row, for config)".
-- Same singleton pattern as the rest of this file: fixed id of 1 plus a
-- check constraint, not a generic settings framework.
CREATE TABLE IF NOT EXISTS organization (
  id integer PRIMARY KEY DEFAULT 1,
  name text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role user_role NOT NULL DEFAULT 'recruiter',
  -- References commission_plan(id), which does not exist until Phase 1.
  -- Left as an unconstrained uuid on purpose -- adding a FK to a table that
  -- doesn't exist yet would be worse than no column, and the spec's own
  -- commission_plan table (3.3) is versioned and immutable, so this will be
  -- a real FK the moment Phase 1 lands, not retrofitted.
  commission_plan_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Spec 0, hard rule 7: "Feature flag everything user facing. Flags are per
-- user and per workflow, stored in the database, togglable without deploy."
-- user_id NULL means "the organization default for this workflow"; a
-- per-user row overrides it. Phase 0 seeds no workflow-specific flags of its
-- own (there are no user-facing workflows to gate yet -- the reconciliation
-- dashboard is read-only and admin-only) but the mechanism has to exist from
-- day one per the hard rule, not be bolted on when Phase 2's workflows show
-- up.
CREATE TABLE IF NOT EXISTS feature_flag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  workflow_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  description text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

-- One row per (user, workflow); a NULL user_id default and a per-user
-- override for the same workflow_key must each be unique on their own.
CREATE UNIQUE INDEX IF NOT EXISTS feature_flag_user_workflow_idx
  ON feature_flag (user_id, workflow_key) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS feature_flag_default_workflow_idx
  ON feature_flag (workflow_key) WHERE user_id IS NULL;

-- Append-only audit trail (spec section 8: "Audit log on every mutation").
-- UPDATE and DELETE are revoked on this table at the database role level in
-- 0002_audit_log_lockdown.sql -- do not rely on application code alone.
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx ON audit_log (occurred_at);

-- Runtime application role. web/worker/scheduler connect as this role, never
-- as the migrations owner. Password is set out of band (see README); this
-- migration only establishes the role and its grants so a fresh environment
-- is never left running the app as a superuser.
DO $$ BEGIN
  CREATE ROLE palladium_app LOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO palladium_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO palladium_app;
GRANT SELECT, INSERT, UPDATE ON organization TO palladium_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, feature_flag TO palladium_app;
-- audit_log: INSERT and SELECT only. UPDATE/DELETE are revoked explicitly in
-- 0002_audit_log_lockdown.sql so the intent is never ambiguous to a reader
-- diffing migrations, even though GRANT here never included them.
GRANT SELECT, INSERT ON audit_log TO palladium_app;

INSERT INTO organization (id, name)
VALUES (1, 'Palladium Point')
ON CONFLICT (id) DO NOTHING;
