-- Section 8 permissions matrix and section 6 do-not-contact guarantee.
-- Both are called out as MVP scope, not deferred (section 0 hard rule 8),
-- and both are "nearly free now and painful to retrofit" (section 8's own
-- rationale), so they land in Phase 1 alongside the tables they protect.
--
-- Column-level lockdown, not row-level: nothing in the Phase 1 permissions
-- matrix restricts which ROWS a role can see (every role's "Pipeline" is
-- "All"). The actual restrictions are two specific columns --
-- client_contract.fee_percent and job.fee_override -- hidden from
-- recruiters, and person_employment.comp, readable by everyone but audited
-- on read for recruiter/ops. The app connects as one pooled role
-- (palladium_app), so per-request identity is passed via transaction-local
-- session variables (SET LOCAL app.actor_user_id / app.actor_role --
-- see src/db/client.ts) that these SECURITY DEFINER functions read. This is
-- the same mechanism Supabase's own auth.uid()/auth.jwt() RLS helpers use
-- under the hood (a session-scoped setting an RLS policy or function reads),
-- adapted for a single-role connection pool since this environment isn't
-- wired to a live Supabase project.

-- Postgres column privileges are additive on top of table-level ones: a
-- role with table-level SELECT can read every column regardless of any
-- column-level REVOKE against it (the column grant only matters when
-- there's no table-level grant to begin with). So the actual lockdown is
-- REVOKE the table-level SELECT entirely, then GRANT SELECT back on every
-- column except the sensitive one. INSERT/UPDATE/DELETE stay table-level --
-- the app still needs to write comp/fee_percent/fee_override, just not
-- read them directly.
REVOKE SELECT ON person_employment FROM palladium_app;
GRANT SELECT (id, person_id, employer_name, brokerage_id, title, is_current, book_of_business, source, created_at)
  ON person_employment TO palladium_app;

REVOKE SELECT ON client_contract FROM palladium_app;
GRANT SELECT (id, client_id, fee_model, fee_basis, guarantee_days, payment_terms_days, effective_from, effective_to, created_at)
  ON client_contract TO palladium_app;

REVOKE SELECT ON job FROM palladium_app;
GRANT SELECT (id, client_id, contract_id, title, status, target_comp_range_min, target_comp_range_max, owner_user_id, created_at)
  ON job TO palladium_app;

CREATE OR REPLACE FUNCTION current_actor_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.actor_user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION current_actor_role() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.actor_role', true), '');
$$ LANGUAGE sql STABLE;

-- Candidate comp data: "Yes, read audited" for recruiter/ops, plain "Yes"
-- for exec. Every role gets the value; recruiter/ops reads write an
-- audit_log row naming who read what and when.
CREATE OR REPLACE FUNCTION get_person_employment_comp(p_employment_id uuid) RETURNS jsonb AS $$
DECLARE
  v_comp jsonb;
  v_role text := current_actor_role();
BEGIN
  SELECT comp INTO v_comp FROM person_employment WHERE id = p_employment_id;

  IF v_role IS DISTINCT FROM 'exec' THEN
    INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after)
    VALUES (current_actor_user_id(), 'read_compensation', 'person_employment', p_employment_id::text,
      jsonb_build_object('role', v_role));
  END IF;

  RETURN v_comp;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Client fee percent: "No" for recruiter, "Yes" for ops/exec. Returns NULL
-- rather than raising, so a recruiter's normal contract query (guarantee
-- days, payment terms, etc.) doesn't have to special-case this one column
-- -- it just never carries a real value for them. The column itself is
-- unreadable by any other path (see the REVOKE above), so this is the only
-- door, and it's the one that says no.
CREATE OR REPLACE FUNCTION get_client_contract_fee_percent(p_contract_id uuid) RETURNS double precision AS $$
DECLARE
  v_fee_percent double precision;
  v_role text := current_actor_role();
BEGIN
  IF v_role = 'recruiter' THEN
    RETURN NULL;
  END IF;

  SELECT fee_percent INTO v_fee_percent FROM client_contract WHERE id = p_contract_id;
  RETURN v_fee_percent;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_job_fee_override(p_job_id uuid) RETURNS double precision AS $$
DECLARE
  v_fee_override double precision;
  v_role text := current_actor_role();
BEGIN
  IF v_role = 'recruiter' THEN
    RETURN NULL;
  END IF;

  SELECT fee_override INTO v_fee_override FROM job WHERE id = p_job_id;
  RETURN v_fee_override;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION get_person_employment_comp(uuid) TO palladium_app;
GRANT EXECUTE ON FUNCTION get_client_contract_fee_percent(uuid) TO palladium_app;
GRANT EXECUTE ON FUNCTION get_job_fee_override(uuid) TO palladium_app;

-- Section 6: "A person with do_not_contact = true cannot be added to an
-- engagement... Enforced at the service layer and by database constraint,
-- not in the UI." The service-layer half lives in src/identity/dnc.ts;
-- this trigger is the database half, which holds even if application code
-- forgets the check.
CREATE OR REPLACE FUNCTION reject_dnc_engagement() RETURNS trigger AS $$
DECLARE
  v_dnc boolean;
BEGIN
  SELECT do_not_contact INTO v_dnc FROM person WHERE id = NEW.person_id;
  IF v_dnc THEN
    RAISE EXCEPTION 'person % is do-not-contact: cannot create or reassign an engagement to them', NEW.person_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS engagement_reject_dnc ON engagement;
CREATE TRIGGER engagement_reject_dnc
  BEFORE INSERT OR UPDATE OF person_id ON engagement
  FOR EACH ROW EXECUTE FUNCTION reject_dnc_engagement();
