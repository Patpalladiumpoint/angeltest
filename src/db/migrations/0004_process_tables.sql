-- Process tables (spec 3.3): "not deferrable -- missing events cannot be
-- invented later." event is the spine every inbound signal becomes before
-- anything else happens. audit_log is "cannot reconstruct who did what" --
-- section 0's own worked example of a build-now item.

DO $$ BEGIN
  CREATE TYPE event_source AS ENUM ('narrow_import', 'manual_ui', 'email_ingest', 'calendar_sync', 'system');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  source event_source NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  external_id text
);

CREATE UNIQUE INDEX IF NOT EXISTS event_external_id_unique_idx ON event (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_entity_idx ON event (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS event_occurred_at_idx ON event (occurred_at);

DO $$ BEGIN
  CREATE TYPE task_type AS ENUM ('manual', 'system_generated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid REFERENCES engagement(id),
  type text NOT NULL,
  task_kind task_type NOT NULL DEFAULT 'manual',
  assignee_user_id uuid REFERENCES app_user(id),
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid REFERENCES app_user(id),
  auto_generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_engagement_idx ON task (engagement_id);

DO $$ BEGIN
  CREATE TYPE exception_severity AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS exception (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  severity exception_severity NOT NULL DEFAULT 'medium',
  revenue_at_risk double precision,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text,
  snoozed_until timestamptz
);

CREATE INDEX IF NOT EXISTS exception_entity_idx ON exception (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES app_user(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  before jsonb,
  after jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at);

CREATE TABLE IF NOT EXISTS activity_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  author_user_id uuid REFERENCES app_user(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_note_entity_idx ON activity_note (entity_type, entity_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON task, exception, activity_note TO palladium_app;

-- event and audit_log: INSERT and SELECT only. UPDATE/DELETE are revoked
-- explicitly below (rather than just never GRANTed) so a reviewer diffing
-- migrations never has to infer the intent.
GRANT SELECT, INSERT ON event TO palladium_app;
GRANT SELECT, INSERT ON audit_log TO palladium_app;

-- Append-only lockdown, two independent layers deliberately: REVOKE at the
-- role level (the actual required control) plus a trigger that raises
-- regardless of role, as defense in depth against a superuser/migrations
-- session running a manual UPDATE by mistake.
REVOKE UPDATE, DELETE ON event FROM palladium_app;
REVOKE UPDATE, DELETE ON event FROM PUBLIC;
REVOKE UPDATE, DELETE ON audit_log FROM palladium_app;
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted (row id %)',
    TG_TABLE_NAME, TG_OP, COALESCE(OLD.id::text, 'unknown');
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_no_update ON event;
CREATE TRIGGER event_no_update BEFORE UPDATE ON event FOR EACH ROW EXECUTE FUNCTION reject_mutation();
DROP TRIGGER IF EXISTS event_no_delete ON event;
CREATE TRIGGER event_no_delete BEFORE DELETE ON event FOR EACH ROW EXECUTE FUNCTION reject_mutation();

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_mutation();
DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_mutation();
