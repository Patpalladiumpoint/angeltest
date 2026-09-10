-- Phase 1 foundation: extensions, organization, users, and the runtime
-- application role. Run by the migrations role (schema owner), never by the
-- app role -- see README "Running locally."

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Fuzzy person-name matching (spec 3.2 step 2) and search (Phase 3).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- pgvector is part of the approved stack (spec section 2) but nothing in
-- Phase 1-3 MVP search uses vector similarity (DECISION 1 explicitly cuts
-- "semantic or vector similarity mode" from MVP search). Supabase projects
-- ship pgvector already enabled; this line is commented out rather than run
-- here because this environment's local Postgres does not have the
-- extension installed, and there is nothing in this migration set that
-- needs it yet.
-- CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS organization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE app_user_role AS ENUM ('recruiter', 'ops', 'exec');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Table is app_user, not "user" (reserved word). authUserId links to
-- Supabase Auth's auth.users.id once this runs against a real Supabase
-- project (spec section 2: "Supabase Auth, Google SSO only") -- see
-- src/auth/README.md for what is and is not verified in this sandbox.
CREATE TABLE IF NOT EXISTS app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  auth_user_id uuid UNIQUE,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role app_user_role NOT NULL DEFAULT 'recruiter',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Runtime application role. The Next.js app and any background job connect
-- as this role, never as the migrations owner/superuser (matches the prior
-- build's custody discipline). Password is set out of band per environment.
DO $$ BEGIN
  CREATE ROLE palladium_app LOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO palladium_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO palladium_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization, app_user TO palladium_app;
