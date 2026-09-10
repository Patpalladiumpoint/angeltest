// Recruiter Scorecards (section 12). Metrics are derived from event/
// engagement_stage_history (real activity, never fabricated) -- a
// recruiter with no sourced/submitted/placed rows in the date range shows
// zeros, not a placeholder number. Date-range filtering via two plain
// timestamp params rather than a composed WHERE fragment (same reasoning
// as src/tasks/queries.ts).
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export type RecruiterScorecard = {
  recruiterId: string;
  recruiterName: string;
  sourced: number;
  submittals: number;
  interviews: number;
  offers: number;
  starts: number;
  activePipeline: number;
  revenue: number;
};

export async function getRecruiterScorecards(from: Date, to: Date): Promise<RecruiterScorecard[]> {
  const rows = await db.execute<{
    recruiter_id: string;
    recruiter_name: string;
    sourced: number;
    submittals: number;
    interviews: number;
    offers: number;
    starts: number;
    active_pipeline: number;
    revenue: number;
  }>(sql`
    WITH transitions AS (
      SELECT h.to_stage, h.changed_at, e.owner_user_id, e.expected_fee
      FROM engagement_stage_history h JOIN engagement e ON e.id = h.engagement_id
      WHERE h.changed_at BETWEEN ${from} AND ${to}
    )
    SELECT
      u.id AS recruiter_id, u.name AS recruiter_name,
      count(*) FILTER (WHERE t.to_stage = 'sourced') AS sourced,
      count(*) FILTER (WHERE t.to_stage = 'submitted') AS submittals,
      count(*) FILTER (WHERE t.to_stage = 'client_process') AS interviews,
      count(*) FILTER (WHERE t.to_stage = 'offer') AS offers,
      count(*) FILTER (WHERE t.to_stage IN ('placed', 'secured')) AS starts,
      (SELECT count(*) FROM engagement e2 WHERE e2.owner_user_id = u.id AND e2.status = 'active')::int AS active_pipeline,
      coalesce(sum(t.expected_fee) FILTER (WHERE t.to_stage IN ('placed', 'secured')), 0) AS revenue
    FROM app_user u
    LEFT JOIN transitions t ON t.owner_user_id = u.id
    WHERE u.role IN ('recruiter', 'ops', 'exec', 'admin') AND u.is_active = true
    GROUP BY u.id, u.name
    ORDER BY revenue DESC
  `);

  return rows.map((r) => ({
    recruiterId: r.recruiter_id,
    recruiterName: r.recruiter_name,
    sourced: Number(r.sourced),
    submittals: Number(r.submittals),
    interviews: Number(r.interviews),
    offers: Number(r.offers),
    starts: Number(r.starts),
    activePipeline: Number(r.active_pipeline),
    revenue: Number(r.revenue),
  }));
}

export function conversionRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}
