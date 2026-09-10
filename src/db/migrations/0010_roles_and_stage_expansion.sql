-- Expands the persona and stage vocabulary without breaking anything that
-- already reads/writes the existing enums (both ALTER TYPE ... ADD VALUE,
-- additive only -- no existing value renamed or removed, no table rebuilt).
--
-- Roles: adds 'admin' (full access including configuration, a superset of
-- 'exec's financial visibility) alongside the existing recruiter/ops/exec.
-- The comp/fee SECURITY DEFINER functions (migrations/0007) already treat
-- 'admin' correctly with zero changes needed for the deny path (they only
-- ever deny 'recruiter'); the audit-exemption path is updated below so an
-- admin read isn't redundantly audited the way exec's isn't.
ALTER TYPE app_user_role ADD VALUE IF NOT EXISTS 'admin';

CREATE OR REPLACE FUNCTION get_person_employment_comp(p_employment_id uuid) RETURNS jsonb AS $$
DECLARE
  v_comp jsonb;
  v_role text := current_actor_role();
BEGIN
  SELECT comp INTO v_comp FROM person_employment WHERE id = p_employment_id;

  IF v_role NOT IN ('exec', 'admin') THEN
    INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
    VALUES (current_actor_user_id(), 'read_compensation', 'person_employment', p_employment_id::text,
      jsonb_build_object('role', v_role));
  END IF;

  RETURN v_comp;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Stages: the existing 9 lifecycle stages + 5 terminal/branch stages stay
-- exactly as they are (nothing renamed -- see src/domain/stages.ts for the
-- canonical display-label mapping the product brief's fuller vocabulary
-- maps onto, e.g. 'engaged' displays as "Active", 'qualified' as
-- "Prescreened"). Interview rounds stay events inside 'client_process'
-- (DECISION 2), not stages of their own -- the new interview table
-- (migration 0011) is where "Sendout", "Follow-Up Interview" etc. actually
-- live. What genuinely doesn't exist yet in the current 14 values: a
-- distinct pending-start window between offer and placed, and the
-- nurture/prospect branch states a real desk needs for candidates who
-- aren't a fit *right now* but are worth keeping warm.
ALTER TYPE engagement_stage ADD VALUE IF NOT EXISTS 'pending_start' AFTER 'offer';
ALTER TYPE engagement_stage ADD VALUE IF NOT EXISTS 'not_interested';
ALTER TYPE engagement_stage ADD VALUE IF NOT EXISTS 'palladium_reject';
ALTER TYPE engagement_stage ADD VALUE IF NOT EXISTS 'future_prospect';
ALTER TYPE engagement_stage ADD VALUE IF NOT EXISTS 'keep_in_touch';
ALTER TYPE engagement_stage ADD VALUE IF NOT EXISTS 'nurture';

-- Pipeline Stage History (spec-requested first-class entity, section 4).
-- Append-only, same lockdown pattern as event/audit_log. Populated by a
-- trigger, not application code, so it can never silently fall out of
-- sync with engagement.current_stage no matter which code path changes
-- it -- narrow importer, a future stage-transition UI action, or a direct
-- admin fix all go through the same table row.
CREATE TABLE IF NOT EXISTS engagement_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES engagement(id),
  from_stage engagement_stage,
  to_stage engagement_stage NOT NULL,
  changed_by uuid REFERENCES app_user(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

CREATE INDEX IF NOT EXISTS engagement_stage_history_engagement_idx ON engagement_stage_history (engagement_id, changed_at);

GRANT SELECT, INSERT ON engagement_stage_history TO palladium_app;
REVOKE UPDATE, DELETE ON engagement_stage_history FROM palladium_app;
REVOKE UPDATE, DELETE ON engagement_stage_history FROM PUBLIC;

DROP TRIGGER IF EXISTS engagement_stage_history_no_update ON engagement_stage_history;
CREATE TRIGGER engagement_stage_history_no_update BEFORE UPDATE ON engagement_stage_history FOR EACH ROW EXECUTE FUNCTION reject_mutation();
DROP TRIGGER IF EXISTS engagement_stage_history_no_delete ON engagement_stage_history;
CREATE TRIGGER engagement_stage_history_no_delete BEFORE DELETE ON engagement_stage_history FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- The trigger that actually keeps history + stage_entered_at correct
-- automatically. Any UPDATE that changes current_stage -- from any code
-- path -- gets a history row and a reset stage clock for free, instead of
-- relying on every call site remembering to do both.
CREATE OR REPLACE FUNCTION record_engagement_stage_change() RETURNS trigger AS $$
BEGIN
  IF NEW.current_stage IS DISTINCT FROM OLD.current_stage THEN
    INSERT INTO engagement_stage_history (engagement_id, from_stage, to_stage, changed_by)
    VALUES (NEW.id, OLD.current_stage, NEW.current_stage, current_actor_user_id());
    NEW.stage_entered_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS engagement_record_stage_change ON engagement;
CREATE TRIGGER engagement_record_stage_change
  BEFORE UPDATE OF current_stage ON engagement
  FOR EACH ROW EXECUTE FUNCTION record_engagement_stage_change();

-- Backfill: one history row per existing engagement recording its current
-- stage as the initial transition, so every engagement (including ones
-- from the narrow importer, which predate this migration) has at least
-- one history row and stage-aging queries never have to special-case "no
-- history yet."
INSERT INTO engagement_stage_history (engagement_id, from_stage, to_stage, changed_at)
SELECT id, NULL, current_stage, stage_entered_at FROM engagement
WHERE NOT EXISTS (SELECT 1 FROM engagement_stage_history WHERE engagement_id = engagement.id);
