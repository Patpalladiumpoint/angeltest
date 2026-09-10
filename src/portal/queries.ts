// Client-scoped reads for the portal. Every query here takes a clientId
// (resolved from the authenticated client_contact, never from user input)
// and never selects outside it -- no cross-client join, ever. Money columns
// (client_contract.fee_percent, job.fee_override, person_employment.comp)
// are never selected here on top of that; even if one were added by
// mistake, migrations/0007's column-level REVOKE blocks it at the database
// level regardless of who's asking (proved directly against Postgres in
// this session -- see README).
//
// Visibility rule (product decision, not spec-mandated): a client sees a
// job's progress once at least one candidate has reached 'engaged' or
// later -- never 'sourced'/'outreach'. Candidates are individually listed
// once 'submitted' or later. This matches how a retained search firm
// actually operates: clients don't watch unconfirmed sourcing, they see
// motion once someone is actually in the funnel.
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

const FUNNEL_STEPS = ["Sourced", "Engaged", "Submitted", "Interviewing", "Offer", "Placed"] as const;
export type FunnelStepLabel = (typeof FUNNEL_STEPS)[number];
export { FUNNEL_STEPS };

// Fixed at compile time -- inlined directly into the queries below rather
// than built dynamically (no need for sql.join() when the list never
// changes at runtime, and it keeps the query text identical to what was
// hand-verified against Postgres in this session).
const PRESENTED_STAGES_SQL = sql`('submitted','client_process','offer','placed','secured','candidate_declined','client_rejected')`;

export type PortalJob = {
  jobId: string;
  title: string;
  status: string;
  createdAt: Date;
  funnelIndex: number; // -1 = nothing visible yet
  presentedCount: number;
  candidates: { personName: string; stage: string; daysInStage: number }[];
};

export async function getClientPortalJobs(clientId: string): Promise<PortalJob[]> {
  const jobRows = await db.execute<{
    job_id: string;
    title: string;
    status: string;
    created_at: Date;
    funnel_index: number;
    presented_count: number;
  }>(sql`
    SELECT
      j.id AS job_id, j.title, j.status, j.created_at,
      COALESCE(MAX(CASE
        WHEN e.current_stage IN ('engaged','qualified') THEN 1
        WHEN e.current_stage = 'submitted' THEN 2
        WHEN e.current_stage = 'client_process' THEN 3
        WHEN e.current_stage = 'offer' THEN 4
        WHEN e.current_stage IN ('placed','secured') THEN 5
        ELSE NULL
      END), -1) AS funnel_index,
      count(*) FILTER (WHERE e.current_stage IN ('submitted','client_process','offer','placed','secured','candidate_declined','client_rejected'))::int AS presented_count
    FROM job j
    LEFT JOIN engagement e ON e.job_id = j.id AND e.status = 'active'
    WHERE j.client_id = ${clientId}
    GROUP BY j.id, j.title, j.status, j.created_at
    ORDER BY j.created_at DESC
  `);

  const jobs: PortalJob[] = [];
  for (const row of jobRows) {
    const candidateRows =
      Number(row.presented_count) > 0
        ? await db.execute<{ person_name: string; current_stage: string; days_in_stage: number }>(sql`
            SELECT p.primary_name AS person_name, e.current_stage, EXTRACT(day FROM now() - e.stage_entered_at)::int AS days_in_stage
            FROM engagement e
            JOIN person p ON p.id = e.person_id
            WHERE e.job_id = ${row.job_id} AND e.status = 'active'
              AND e.current_stage IN ${PRESENTED_STAGES_SQL}
            ORDER BY e.stage_entered_at DESC
          `)
        : [];

    jobs.push({
      jobId: row.job_id,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      funnelIndex: Number(row.funnel_index),
      presentedCount: Number(row.presented_count),
      candidates: candidateRows.map((c) => ({
        personName: c.person_name,
        stage: c.current_stage,
        daysInStage: Number(c.days_in_stage),
      })),
    });
  }

  return jobs;
}

export type PortalActivityItem = { occurredAt: Date; type: string; jobTitle: string | null };

export async function getClientPortalActivity(clientId: string, limit = 10): Promise<PortalActivityItem[]> {
  const rows = await db.execute<{ occurred_at: Date; type: string; job_title: string | null }>(sql`
    SELECT ev.occurred_at, ev.type, j.title AS job_title
    FROM event ev
    JOIN engagement e ON e.id::text = ev.entity_id AND ev.entity_type = 'engagement'
    JOIN job j ON j.id = e.job_id
    WHERE j.client_id = ${clientId}
    ORDER BY ev.occurred_at DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({ occurredAt: r.occurred_at, type: r.type, jobTitle: r.job_title }));
}
