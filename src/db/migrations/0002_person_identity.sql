-- Person: canonical human record, plus identity resolution (spec 3.1, 3.2).
-- "One person, many roles" -- not deferrable per DECISION 0's own worked
-- example (the most expensive thing to get wrong later).

CREATE TABLE IF NOT EXISTS person (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  primary_name text NOT NULL,
  normalized_name_key text NOT NULL,
  dedup_fingerprint text,
  do_not_contact boolean NOT NULL DEFAULT false,
  dnc_reason text,
  dnc_set_at timestamptz,
  created_from text NOT NULL DEFAULT 'manual',
  retention_reviewed_at timestamptz,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS person_normalized_name_idx ON person (normalized_name_key);
CREATE INDEX IF NOT EXISTS person_dedup_fingerprint_idx ON person (dedup_fingerprint);
-- Fuzzy match tier (spec 3.2 step 2) similarity() lookups.
CREATE INDEX IF NOT EXISTS person_primary_name_trgm_idx ON person USING gin (primary_name gin_trgm_ops);

DO $$ BEGIN
  CREATE TYPE person_identifier_type AS ENUM ('email', 'phone', 'linkedin_url', 'legacy_id');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Deterministic-match tier (spec 3.2 step 1): the UNIQUE constraint below
-- *is* the enforcement -- an insert that collides on (type, normalized
-- value) is the match, not a query the app has to remember to run.
CREATE TABLE IF NOT EXISTS person_identifier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person(id),
  type person_identifier_type NOT NULL,
  value text NOT NULL,
  normalized_value text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type, normalized_value)
);

CREATE INDEX IF NOT EXISTS person_identifier_person_idx ON person_identifier (person_id);

DO $$ BEGIN
  CREATE TYPE person_employment_source AS ENUM ('narrow_import', 'manual', 'resume_parse');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS person_employment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person(id),
  employer_name text NOT NULL,
  brokerage_id uuid, -- FK added in 0003 once brokerage exists
  title text,
  is_current boolean NOT NULL DEFAULT true,
  -- Section 8: candidate comp data access is restricted and audited on
  -- read. Direct SELECT on this column is revoked from palladium_app in
  -- 0007_permissions_and_dnc.sql; reads go through get_person_employment_comp().
  comp jsonb,
  book_of_business jsonb,
  source person_employment_source NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS person_employment_person_idx ON person_employment (person_id);

-- Reversible merges, no hard deletes, ever (spec 3.2, section 0's own
-- worked example). absorbed_snapshot holds the absorbed person's full
-- pre-merge state (row plus its identifiers/employment) so a reversal never
-- has to reconstruct anything from elsewhere.
CREATE TABLE IF NOT EXISTS person_merge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surviving_person_id uuid NOT NULL REFERENCES person(id),
  absorbed_person_id uuid NOT NULL REFERENCES person(id),
  absorbed_snapshot jsonb NOT NULL,
  merged_by uuid REFERENCES app_user(id),
  merged_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES app_user(id)
);

CREATE INDEX IF NOT EXISTS person_merge_surviving_idx ON person_merge (surviving_person_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON person, person_identifier, person_employment, person_merge TO palladium_app;
