-- Found while building demo data: migration 0010's own comment says the
-- goal is "every engagement... has at least one history row [so]
-- stage-aging queries never have to special-case 'no history yet'" -- but
-- that guarantee was only ever true for engagements that existed at the
-- moment 0010 ran its one-time backfill INSERT. Every engagement created
-- since then via a direct INSERT at a non-default stage (the narrow
-- importer's resolveJob()/engagement-creation path, and any future
-- "add a candidate already at stage X" flow) gets zero history rows until
-- its first real transitionEngagementStage() call, because the existing
-- trigger (engagement_record_stage_change, migration 0010) only fires
-- `BEFORE UPDATE OF current_stage` -- never on INSERT.
--
-- Concretely: an imported engagement inserted directly at 'secured' never
-- shows up in DCT's "Recently Closed" view (src/dct/queries.ts,
-- listRecentlyClosedDeals(), which reads from engagement_stage_history)
-- until someone manually transitions it again -- silently wrong for data
-- that arrived already-closed, exactly the shape narrow-imported legacy
-- placements take.
--
-- Fix: an AFTER INSERT trigger that writes one history row per new
-- engagement (NULL -> current_stage, at stage_entered_at), the exact same
-- shape the 0010 backfill wrote for pre-existing rows -- so this
-- guarantee now actually holds for every engagement, not just the ones
-- that existed on one particular day.
CREATE OR REPLACE FUNCTION record_engagement_initial_stage() RETURNS trigger AS $$
BEGIN
  INSERT INTO engagement_stage_history (engagement_id, from_stage, to_stage, changed_at)
  VALUES (NEW.id, NULL, NEW.current_stage, NEW.stage_entered_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS engagement_record_initial_stage ON engagement;
CREATE TRIGGER engagement_record_initial_stage
  AFTER INSERT ON engagement
  FOR EACH ROW EXECUTE FUNCTION record_engagement_initial_stage();
