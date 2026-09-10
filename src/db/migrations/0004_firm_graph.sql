-- Phase 1: firm graph and resolver support (spec section 5 "Firms and
-- clients" / section 7.3). Expands the MVP's trimmed `firms` table and adds
-- firm_aliases and firm_events. See src/firms/resolver.ts for the algorithm
-- these tables support.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  CREATE TYPE firm_type AS ENUM ('brokerage', 'carrier', 'mga', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE firms
  ADD COLUMN IF NOT EXISTS normalized_canonical_name text,
  ADD COLUMN IF NOT EXISTS top100_list_year integer,
  ADD COLUMN IF NOT EXISTS us_brokerage_revenue_dollars bigint,
  ADD COLUMN IF NOT EXISTS firm_type firm_type NOT NULL DEFAULT 'brokerage',
  ADD COLUMN IF NOT EXISTS parent_firm_id uuid REFERENCES firms(id),
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS notes text;

-- Trigram index for the resolver's fuzzy-match tier (spec 7.3 step 2c,
-- "trigram similarity > 0.85"), targeting the *normalized* name -- both the
-- exact and fuzzy tiers compare against normalized_canonical_name, never
-- the raw canonicalName (spec 7.3 step 2a: "exact on firms.canonical_name
-- normalized"). Without this index the similarity() query does a full scan
-- past a few hundred firms.
CREATE INDEX IF NOT EXISTS firms_normalized_name_trgm_idx
  ON firms USING gin (normalized_canonical_name gin_trgm_ops);

-- Without this, two firm rows normalizing to the same string would make
-- the resolver's exact-match tier pick an arbitrary one instead of failing
-- loudly. Partial because normalized_canonical_name is nullable until
-- application code backfills it.
CREATE UNIQUE INDEX IF NOT EXISTS firms_normalized_name_unique_idx
  ON firms (normalized_canonical_name) WHERE normalized_canonical_name IS NOT NULL;

DO $$ BEGIN
  CREATE TYPE firm_alias_type AS ENUM ('dba', 'former_name', 'abbreviation', 'misspelling');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS firm_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  alias text NOT NULL,
  alias_type firm_alias_type NOT NULL,
  normalized_alias text NOT NULL
);

-- Unique, not just indexed: the same alias pointing at two different firms
-- would make the alias tier ambiguous, and is almost always a data-entry
-- mistake worth failing loudly on rather than silently picking one.
CREATE UNIQUE INDEX IF NOT EXISTS firm_aliases_normalized_unique_idx ON firm_aliases (normalized_alias);
CREATE INDEX IF NOT EXISTS firm_aliases_normalized_trgm_idx
  ON firm_aliases USING gin (normalized_alias gin_trgm_ops);

DO $$ BEGIN
  CREATE TYPE firm_event_type AS ENUM ('acquired_by', 'renamed', 'merged');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS firm_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  event_type firm_event_type NOT NULL,
  counterparty_firm_id uuid REFERENCES firms(id),
  announced_at timestamptz,
  effective_at timestamptz,
  source_url text
);

CREATE INDEX IF NOT EXISTS firm_events_firm_idx ON firm_events (firm_id);

GRANT SELECT, INSERT, UPDATE ON firm_aliases, firm_events TO palladium_app;
