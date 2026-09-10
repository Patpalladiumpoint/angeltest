-- Data quality expansion (section 17): "placement with no invoice" needs to
-- check the real `invoice` table now that migration 0013 built it, instead
-- of the Phase-1-era legacy_placement_import placeholder. invoice has
-- table-level SELECT revoked from palladium_app (0013), so this reuses the
-- same SECURITY DEFINER + role-scoped pattern as invoices_for_actor() rather
-- than granting a wider SELECT back -- the report must respect the same
-- recruiter-sees-own / ops-exec-admin-see-all boundary as the Finance page.

-- Returns person_name directly (joining person/engagement inside the
-- function) rather than just IDs, so the caller doesn't need a second
-- query keyed by an array of returned placement ids -- keeps this to one
-- round trip and avoids relying on how the JS driver serializes an array
-- parameter for `= ANY($1::uuid[])`, which nothing else in this codebase
-- does yet and couldn't be verified against the real driver in this
-- npm-less sandbox (see docs/manual-steps.md).
CREATE OR REPLACE FUNCTION placements_missing_invoice_for_actor()
RETURNS TABLE(placement_id uuid, engagement_id uuid, start_date timestamptz, person_name text) AS $$
DECLARE v_role text := current_actor_role();
BEGIN
  IF v_role IN ('ops', 'exec', 'admin') THEN
    RETURN QUERY
      SELECT pl.id, pl.engagement_id, pl.start_date, p.primary_name
      FROM placement pl
      JOIN engagement e ON e.id = pl.engagement_id
      JOIN person p ON p.id = e.person_id
      LEFT JOIN invoice i ON i.placement_id = pl.id
      WHERE i.id IS NULL
      ORDER BY pl.created_at DESC;
  ELSIF v_role = 'recruiter' THEN
    RETURN QUERY
      SELECT pl.id, pl.engagement_id, pl.start_date, p.primary_name
      FROM placement pl
      JOIN engagement e ON e.id = pl.engagement_id
      JOIN person p ON p.id = e.person_id
      LEFT JOIN invoice i ON i.placement_id = pl.id
      WHERE i.id IS NULL AND e.owner_user_id = current_actor_user_id()
      ORDER BY pl.created_at DESC;
  END IF;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION placements_missing_invoice_for_actor() TO palladium_app;
