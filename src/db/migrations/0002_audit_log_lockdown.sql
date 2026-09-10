-- Enforces spec 3.6: "Revoke UPDATE and DELETE on this table at the database
-- role level" and acceptance criterion 3: "audit_log rejects UPDATE and
-- DELETE at the database role level."
--
-- Two independent layers, deliberately redundant:
--   1. REVOKE at the role level -- the actual required control. The app role
--      (and PUBLIC) simply does not have the privilege.
--   2. A trigger that raises on UPDATE/DELETE regardless of role -- defense
--      in depth against a superuser or migrations-role session running a
--      manual UPDATE by mistake. Cheap to keep, and the audit log is the one
--      table where "someone fat-fingered a manual fix" must be impossible,
--      not just discouraged.

REVOKE UPDATE, DELETE ON audit_log FROM palladium_app;
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted (row id %)',
    TG_OP,
    COALESCE(OLD.id::text, 'unknown');
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
