-- Extends the existing task table (Phase 1 schema, unused beyond its
-- column definitions until now) into the real Tasks / Action Queue +
-- Deal Control Tower engine (sections 6 and 10). Additive columns only --
-- engagement_id stays exactly as it was for every existing caller;
-- entity_type/entity_id is the new polymorphic reference (matching the
-- pattern activity_note/document_file/exception already use) for tasks
-- that attach to something other than an engagement -- an invoice, a
-- client, an interview.

DO $$ BEGIN
  CREATE TYPE task_category AS ENUM (
    'client_follow_up', 'candidate_follow_up', 'interview', 'offer', 'finance', 'data_quality', 'general'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The four Deal Control Tower SLA zones (section 6). Nullable: most tasks
-- (a manual to-do, a data-quality item) aren't part of an SLA clock at all
-- -- only the auto-generated stage-transition tasks are.
DO $$ BEGIN
  CREATE TYPE sla_zone AS ENUM (
    'submittal_to_feedback', 'yes_to_interview', 'interview_to_feedback', 'offer_to_start'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE task ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE task ADD COLUMN IF NOT EXISTS entity_id text;
ALTER TABLE task ADD COLUMN IF NOT EXISTS category task_category NOT NULL DEFAULT 'general';
ALTER TABLE task ADD COLUMN IF NOT EXISTS priority task_priority NOT NULL DEFAULT 'medium';
ALTER TABLE task ADD COLUMN IF NOT EXISTS sla_zone sla_zone;
ALTER TABLE task ADD COLUMN IF NOT EXISTS notes text;

-- Backfill entity_type/entity_id from the existing engagement_id column so
-- every pre-existing task (there are none in practice yet -- Phase 1 never
-- wrote to this table -- but this is the honest, safe way to extend a live
-- column) is queryable the new way too.
UPDATE task SET entity_type = 'engagement', entity_id = engagement_id::text
WHERE engagement_id IS NOT NULL AND entity_type IS NULL;

CREATE INDEX IF NOT EXISTS task_entity_idx ON task (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS task_assignee_due_idx ON task (assignee_user_id, due_at);
CREATE INDEX IF NOT EXISTS task_sla_zone_idx ON task (sla_zone) WHERE sla_zone IS NOT NULL;

-- "Needs action today / overdue" (Tasks module and DCT alike) always
-- excludes completed tasks -- a partial index on the open subset keeps
-- that hot query cheap regardless of how many completed tasks pile up.
CREATE INDEX IF NOT EXISTS task_open_due_idx ON task (due_at) WHERE completed_at IS NULL;
