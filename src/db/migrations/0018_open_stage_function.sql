-- Fixes a real bug found while building demo data: every "stalled" /
-- "open deal" / "needs a next action" query in the app excluded only
-- ('placed', 'secured') as "already done" -- the same fix this repo
-- already applied once for the Pipeline table's stalled-flag bug
-- (commit "Fix pipeline table: secured placements were flagged as
-- stalled"). But a closed-lost engagement (candidate_declined,
-- client_rejected, palladium_reject, withdrawn, fell_off) or a nurture
-- one (not_interested, future_prospect, keep_in_touch, nurture) is
-- ALSO already done -- it just isn't done via placed/secured. Left
-- unfixed, a client-rejected search from three months ago never stops
-- counting toward "Stalled," "Revenue at Risk," the DCT's "Active
-- Deals," and now the Data Quality report's "no next action" check --
-- the exact same false alarm the original fix was written to prevent,
-- just for the other five-plus-four stage values nobody thought to
-- exclude.
--
-- One function, not five more copies of a stage literal list, so this
-- can't drift out of sync with itself the way the un-fixed callers had
-- already drifted from the original placed/secured fix. Must be kept in
-- sync BY HAND with OPEN_STAGES in src/domain/stages.ts (SQL can't
-- import a TS module) -- that module's own comment now points back here.
CREATE OR REPLACE FUNCTION is_open_engagement_stage(stage engagement_stage) RETURNS boolean AS $$
  SELECT stage IN (
    'sourced', 'outreach', 'engaged', 'qualified', 'submitted',
    'client_process', 'offer', 'pending_start', 'on_hold'
  );
$$ LANGUAGE sql IMMUTABLE;

GRANT EXECUTE ON FUNCTION is_open_engagement_stage(engagement_stage) TO palladium_app;
