// Pipeline view queries (the restyled internal Palladium OS home page,
// src/app/dashboard/page.tsx). Raw SQL via db.execute rather than composed
// drizzle joins -- this touches enough tables (engagement, person, job,
// person_employment, app_user, placement, person_merge_candidate) that
// hand-written SQL is easier to get right without a compiler in this
// sandbox to catch a query-builder mistake (see README, "no npm registry
// access").
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export type PipelineRow = {
  engagementId: string;
  personId: string;
  personName: string;
  currentEmployer: string | null;
  jobTitle: string;
  currentStage: string;
  ownerName: string | null;
  daysInStage: number;
  expectedFee: number | null;
};

// Threshold for "hot" (idle-cell.hot in the stylesheet) -- illustrative
// default, not a real SLA. The actual per-stage SLA is spec 5.2's state
// machine (Phase 3); this view has no stage config to read one from yet.
export const STALE_DAYS_THRESHOLD = 14;

export async function listActiveEngagements(): Promise<PipelineRow[]> {
  const rows = await db.execute<{
    engagement_id: string;
    person_id: string;
    person_name: string;
    current_employer: string | null;
    job_title: string;
    current_stage: string;
    owner_name: string | null;
    days_in_stage: number;
    expected_fee: number | null;
  }>(sql`
    SELECT
      e.id AS engagement_id,
      p.id AS person_id,
      p.primary_name AS person_name,
      pe.employer_name AS current_employer,
      j.title AS job_title,
      e.current_stage,
      u.name AS owner_name,
      EXTRACT(day FROM now() - e.stage_entered_at)::int AS days_in_stage,
      e.expected_fee
    FROM engagement e
    JOIN person p ON p.id = e.person_id
    JOIN job j ON j.id = e.job_id
    LEFT JOIN app_user u ON u.id = e.owner_user_id
    LEFT JOIN LATERAL (
      SELECT employer_name FROM person_employment
      WHERE person_id = p.id AND is_current = true
      ORDER BY created_at DESC LIMIT 1
    ) pe ON true
    WHERE e.status = 'active'
    ORDER BY e.created_at DESC
  `);

  return rows.map((r) => ({
    engagementId: r.engagement_id,
    personId: r.person_id,
    personName: r.person_name,
    currentEmployer: r.current_employer,
    jobTitle: r.job_title,
    currentStage: r.current_stage,
    ownerName: r.owner_name,
    daysInStage: Number(r.days_in_stage),
    expectedFee: r.expected_fee !== null ? Number(r.expected_fee) : null,
  }));
}

export type PipelineKpis = {
  activeEngagements: number;
  stalledCount: number;
  revenueAtRisk: number;
  pendingMerges: number;
  placementsMtd: number;
  placementsMtdFee: number;
};

export async function getPipelineKpis(): Promise<PipelineKpis> {
  const [row] = await db.execute<{
    active_engagements: number;
    stalled_count: number;
    revenue_at_risk: number;
    pending_merges: number;
    placements_mtd: number;
    placements_mtd_fee: number;
  }>(sql`
    SELECT
      -- "Across every open search" (the tile's own sub-label): a
      -- closed-lost or nurture engagement isn't an open search any more
      -- than a placed/secured one is, so this uses the same open-stage
      -- classification as stalled_count/revenue_at_risk below rather
      -- than just filtering on status (which nothing currently sets to
      -- 'closed' -- see docs/mvp-status.md).
      (SELECT count(*)::int FROM engagement WHERE status = 'active' AND is_open_engagement_stage(current_stage)) AS active_engagements,
      (SELECT count(*)::int FROM engagement
        WHERE status = 'active' AND is_open_engagement_stage(current_stage)
          AND stage_entered_at < now() - make_interval(days => ${STALE_DAYS_THRESHOLD})) AS stalled_count,
      (SELECT coalesce(sum(expected_fee), 0) FROM engagement
        WHERE status = 'active' AND is_open_engagement_stage(current_stage)
          AND stage_entered_at < now() - make_interval(days => ${STALE_DAYS_THRESHOLD})) AS revenue_at_risk,
      (SELECT count(*)::int FROM person_merge_candidate WHERE status = 'pending') AS pending_merges,
      (SELECT count(*)::int FROM placement WHERE start_date >= date_trunc('month', now())) AS placements_mtd,
      (SELECT coalesce(sum(fee_amount), 0) FROM placement WHERE start_date >= date_trunc('month', now())) AS placements_mtd_fee
  `);

  return {
    activeEngagements: Number(row?.active_engagements ?? 0),
    stalledCount: Number(row?.stalled_count ?? 0),
    revenueAtRisk: Number(row?.revenue_at_risk ?? 0),
    pendingMerges: Number(row?.pending_merges ?? 0),
    placementsMtd: Number(row?.placements_mtd ?? 0),
    placementsMtdFee: Number(row?.placements_mtd_fee ?? 0),
  };
}
