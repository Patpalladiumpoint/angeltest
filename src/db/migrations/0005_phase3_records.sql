-- Phase 3: core records UI support. Candidate fields beyond the MVP cut,
-- full-text search, engagements, documents, activities.

DO $$ BEGIN
  CREATE TYPE candidate_source AS ENUM ('sourced', 'referral', 'inbound', 'migrated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE firm_resolution_method AS ENUM ('exact', 'alias', 'fuzzy', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS preferred_name text,
  ADD COLUMN IF NOT EXISTS firm_resolution_confidence double precision,
  ADD COLUMN IF NOT EXISTS firm_resolution_method firm_resolution_method,
  ADD COLUMN IF NOT EXISTS specialty text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS seniority text,
  ADD COLUMN IF NOT EXISTS source candidate_source NOT NULL DEFAULT 'sourced',
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS dnc_reason text,
  ADD COLUMN IF NOT EXISTS dnc_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES candidates(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS candidates_merged_into_idx ON candidates (merged_into_id);

-- Full-text search (spec 5 `search_vector`, section 4 "Postgres full-text
-- search (tsvector)"). A generated column, not a trigger: Postgres keeps it
-- in sync automatically and it can never drift out of sync with an edit
-- that forgets to fire a trigger. Weighted so a name match ranks above a
-- title/specialty match, which ranks above the free-text summary.
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(full_name, '') || ' ' || coalesce(preferred_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(current_title, '') || ' ' || coalesce(specialty, '') || ' ' || coalesce(current_firm_raw, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(location, '') || ' ' || coalesce(seniority, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS candidates_search_vector_idx ON candidates USING gin (search_vector);

DO $$ BEGIN
  CREATE TYPE engagement_type AS ENUM ('retained', 'contingent', 'consulting');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE engagement_status AS ENUM ('active', 'completed', 'lapsed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE off_limits_scope AS ENUM ('firm_wide', 'division', 'named_individuals', 'none');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS engagements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  engagement_type engagement_type NOT NULL DEFAULT 'retained',
  status engagement_status NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  off_limits_scope off_limits_scope NOT NULL DEFAULT 'firm_wide',
  off_limits_expires_at timestamptz,
  terms_notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engagements_firm_idx ON engagements (firm_id);

DO $$ BEGIN
  CREATE TYPE document_type AS ENUM ('resume', 'attachment', 'note_file');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE document_parse_status AS ENUM ('pending', 'parsed', 'failed', 'not_applicable');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  doc_type document_type NOT NULL,
  storage_key text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  checksum_sha256 text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  parsed_at timestamptz,
  parse_status document_parse_status NOT NULL DEFAULT 'pending',
  extracted_text text,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_candidate_idx ON documents (candidate_id);

DO $$ BEGIN
  CREATE TYPE activity_type AS ENUM ('call', 'note', 'meeting', 'email', 'linkedin', 'stage_change', 'system');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE activity_direction AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  search_id uuid, -- FK added once `searches` exists (Phase 4)
  user_id uuid REFERENCES users(id),
  activity_type activity_type NOT NULL,
  direction activity_direction,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  subject text,
  body text,
  email_thread_id text,
  provider_message_id text,
  is_auto_captured boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS activities_candidate_occurred_idx ON activities (candidate_id, occurred_at DESC);

GRANT SELECT, INSERT, UPDATE ON engagements, documents, activities TO palladium_app;
