-- MVP slice: firms, candidates, ownership claims, and the contact ledger.
-- See src/db/schema.ts for what this deliberately does and doesn't cover
-- relative to the full spec (no firm resolver, no eligibility engine).

DO $$ BEGIN
  CREATE TYPE firm_status AS ENUM ('active', 'acquired', 'renamed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  top100_rank integer,
  status firm_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  current_title text,
  current_firm_raw text,
  resolved_firm_id uuid REFERENCES firms(id),
  linkedin_url text,
  do_not_contact boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE claim_status AS ENUM ('active', 'released');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE claim_basis AS ENUM ('first_touch', 'manual_override');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS candidate_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  claim_basis claim_basis NOT NULL DEFAULT 'first_touch',
  status claim_status NOT NULL DEFAULT 'active',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  release_reason text
);

-- The actual enforcement of "one active claim per candidate" (spec 8.2).
-- Holds under concurrent inserts, unlike an app-level check-then-insert.
CREATE UNIQUE INDEX IF NOT EXISTS candidate_claims_one_active_idx
  ON candidate_claims (candidate_id)
  WHERE status = 'active';

DO $$ BEGIN
  CREATE TYPE contact_channel AS ENUM ('call', 'email', 'linkedin', 'note');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS contact_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  user_id uuid NOT NULL REFERENCES users(id),
  channel contact_channel NOT NULL,
  outcome text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_ledger_candidate_occurred_idx
  ON contact_ledger (candidate_id, occurred_at DESC);

GRANT SELECT, INSERT, UPDATE ON firms, candidates, candidate_claims, contact_ledger TO palladium_app;
