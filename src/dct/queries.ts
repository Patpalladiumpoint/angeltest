// Deal Control Tower (section 6). One query returns every open,
// engagement-linked task with enough context to slice into every required
// view (Active Deals, Needs Action Today, Overdue, Waiting on Client/
// Candidate/Recruiter, Upcoming Interviews, Offer/Pending Start, Recently
// Closed) -- computed once per page load in src/app/dct/page.tsx rather
// than issuing eight separate round trips that could disagree with each
// other about what "overdue" means. SLA status itself is computed by
// src/domain/sla.ts, the same module the pipeline table's stalled-flag
// fix and the Tasks module both use.
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { TERMINAL_STAGES } from "@/domain/stages";

export type DctDeal = {
  engagementId: string;
  personName: string;
  jobTitle: string;
  clientName: string;
  ownerName: string | null;
  currentStage: string;
  taskId: string | null;
  taskType: string | null;
  taskCategory: string | null;
  slaZone: string | null;
  dueAt: Date | null;
  nextInterviewAt: Date | null;
};

export async function listOpenDeals(): Promise<DctDeal[]> {
  const rows = await db.execute<{
    engagement_id: string;
    person_name: string;
    job_title: string;
    client_name: string;
    owner_name: string | null;
    current_stage: string;
    task_id: string | null;
    task_type: string | null;
    task_category: string | null;
    sla_zone: string | null;
    due_at: Date | null;
    next_interview_at: Date | null;
  }>(sql`
    SELECT
      e.id AS engagement_id, p.primary_name AS person_name, j.title AS job_title, b.name AS client_name,
      u.name AS owner_name, e.current_stage,
      t.id AS task_id, t.type AS task_type, t.category::text AS task_category, t.sla_zone::text AS sla_zone, t.due_at,
      iv.next_interview_at
    FROM engagement e
    JOIN person p ON p.id = e.person_id
    JOIN job j ON j.id = e.job_id
    JOIN client c ON c.id = j.client_id
    JOIN brokerage b ON b.id = c.brokerage_id
    LEFT JOIN app_user u ON u.id = e.owner_user_id
    LEFT JOIN LATERAL (
      SELECT id, type, category, sla_zone, due_at FROM task
      WHERE entity_type = 'engagement' AND entity_id = e.id::text AND completed_at IS NULL
      ORDER BY due_at ASC NULLS LAST LIMIT 1
    ) t ON true
    LEFT JOIN LATERAL (
      SELECT min(scheduled_at) AS next_interview_at FROM interview
      WHERE engagement_id = e.id AND status = 'scheduled' AND scheduled_at > now()
    ) iv ON true
    WHERE e.status = 'active' AND e.current_stage NOT IN ('placed', 'secured')
    ORDER BY t.due_at ASC NULLS LAST
  `);

  return rows.map((r) => ({
    engagementId: r.engagement_id,
    personName: r.person_name,
    jobTitle: r.job_title,
    clientName: r.client_name,
    ownerName: r.owner_name,
    currentStage: r.current_stage,
    taskId: r.task_id,
    taskType: r.task_type,
    taskCategory: r.task_category,
    slaZone: r.sla_zone,
    dueAt: r.due_at,
    nextInterviewAt: r.next_interview_at,
  }));
}

export type RecentlyClosedDeal = {
  engagementId: string;
  personName: string;
  jobTitle: string;
  clientName: string;
  currentStage: string;
  closedAt: Date;
};

// "Recently closed" pulls from engagement_stage_history, not just
// engagement.current_stage -- an engagement could theoretically move past
// placed/secured to something else later (a fall-off), and history is the
// only reliable record of *when* it became closed-won, not just that it
// currently is.
export async function listRecentlyClosedDeals(days = 14): Promise<RecentlyClosedDeal[]> {
  const rows = await db.execute<{
    engagement_id: string;
    person_name: string;
    job_title: string;
    client_name: string;
    current_stage: string;
    closed_at: Date;
  }>(sql`
    SELECT DISTINCT ON (e.id)
      e.id AS engagement_id, p.primary_name AS person_name, j.title AS job_title, b.name AS client_name,
      e.current_stage, h.changed_at AS closed_at
    FROM engagement_stage_history h
    JOIN engagement e ON e.id = h.engagement_id
    JOIN person p ON p.id = e.person_id
    JOIN job j ON j.id = e.job_id
    JOIN client c ON c.id = j.client_id
    JOIN brokerage b ON b.id = c.brokerage_id
    WHERE h.to_stage IN ('placed', 'secured') AND h.changed_at > now() - make_interval(days => ${days})
    ORDER BY e.id, h.changed_at DESC
  `);

  return rows.map((r) => ({
    engagementId: r.engagement_id,
    personName: r.person_name,
    jobTitle: r.job_title,
    clientName: r.client_name,
    currentStage: r.current_stage,
    closedAt: r.closed_at,
  }));
}

export { TERMINAL_STAGES };
