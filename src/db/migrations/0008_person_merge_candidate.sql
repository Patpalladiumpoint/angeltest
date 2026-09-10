-- Merge review queue (spec 3.2 step 2 + Phase 1 bullet: "Merge review
-- queue, worked down to zero strong-match candidates"). Not one of spec
-- section 3's named tables -- the spec says "surface in a merge review
-- queue" without naming its storage, and a queue needs persisted state
-- (pending/merged/rejected) or the same non-duplicate pair resurfaces every
-- time the fuzzy-match query runs. Additive, and cheap to fold into
-- person_merge later if that ever seems cleaner -- passes DECISION 0's own
-- backfillable test either way.

DO $$ BEGIN
  CREATE TYPE person_merge_candidate_status AS ENUM ('pending', 'merged', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS person_merge_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_a_id uuid NOT NULL REFERENCES person(id),
  person_b_id uuid NOT NULL REFERENCES person(id),
  similarity double precision NOT NULL,
  matched_on text NOT NULL, -- e.g. 'name_trgm+current_employer'
  status person_merge_candidate_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES app_user(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_merge_candidate_ordered_pair CHECK (person_a_id < person_b_id),
  UNIQUE (person_a_id, person_b_id)
);

CREATE INDEX IF NOT EXISTS person_merge_candidate_status_idx ON person_merge_candidate (status);

GRANT SELECT, INSERT, UPDATE, DELETE ON person_merge_candidate TO palladium_app;
