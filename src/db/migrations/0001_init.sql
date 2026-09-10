-- Phase 0 foundation tables: users, single-row config, append-only audit log.
-- Run by the migrations role (schema owner), never by the app role.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('recruiter', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role user_role NOT NULL DEFAULT 'recruiter',
  mailbox_provider text,
  oauth_token_ref text,
  daily_email_cap integer NOT NULL DEFAULT 40,
  timezone text NOT NULL DEFAULT 'America/New_York',
  voice_profile jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Single-row config table. The check constraint plus a fixed id of 1 is the
-- whole enforcement mechanism -- no generic settings framework.
CREATE TABLE IF NOT EXISTS system_settings (
  id integer PRIMARY KEY DEFAULT 1,
  outbound_enabled boolean NOT NULL DEFAULT true,
  last_backup_at timestamptz,
  last_restore_drill_at timestamptz,
  last_restore_drill_passed boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id),
  CONSTRAINT system_settings_singleton CHECK (id = 1)
);

INSERT INTO system_settings (id, outbound_enabled)
VALUES (1, true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

-- Seed the LinkedIn automation flag disabled, per spec 3.2. The row's
-- existence documents the risk acceptance; enabling it is a deliberate,
-- logged admin action, not a default.
INSERT INTO feature_flags (key, enabled, description)
VALUES (
  'linkedin_automation',
  false,
  'Enables AutomationLinkedInProvider. Unimplemented stub; carries LinkedIn ToS and account-restriction exposure. Do not enable without a separate legal review (spec 3.2, OQ 8).'
)
ON CONFLICT (key) DO NOTHING;

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
GRANT SELECT, INSERT, UPDATE, DELETE ON users, system_settings, feature_flags TO palladium_app;
-- audit_log: INSERT and SELECT only. UPDATE/DELETE are revoked explicitly in
-- 0002_audit_log_lockdown.sql so the intent is never ambiguous to a reader
-- diffing migrations, even though GRANT here never included them.
GRANT SELECT, INSERT ON audit_log TO palladium_app;
