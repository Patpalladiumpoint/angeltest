// Candidate 360 (section 7). The activity timeline is a UNION of four
// different tables normalized to one (occurred_at, kind, summary) shape --
// event, activity_note, engagement_stage_history, and interview -- rather
// than a separate query per source the page has to interleave and sort
// itself. All scoped to one person's engagements via a CTE so the query
// stays a single round trip.
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export type CandidateSummary = {
  personId: string;
  primaryName: string;
  currentEmployer: string | null;
  currentTitle: string | null;
  doNotContact: boolean;
  ownerName: string | null;
};

export async function listCandidates(searchQuery?: string): Promise<CandidateSummary[]> {
  // A plain '%' pattern matches every row, so the same query structure
  // serves both "no search" and "search for X" without a conditionally
  // composed WHERE clause (see src/tasks/queries.ts's header comment for
  // why this codebase avoids sql`` fragment composition -- unverifiable
  // in this sandbox, so every query here is one concrete template).
  const likePattern = `%${searchQuery ?? ""}%`;
  const rows = await db.execute<{
    person_id: string;
    primary_name: string;
    current_employer: string | null;
    current_title: string | null;
    do_not_contact: boolean;
    owner_name: string | null;
  }>(sql`
    SELECT
      p.id AS person_id, p.primary_name, pe.employer_name AS current_employer, pe.title AS current_title,
      p.do_not_contact, u.name AS owner_name
    FROM person p
    LEFT JOIN LATERAL (
      SELECT employer_name, title FROM person_employment WHERE person_id = p.id AND is_current = true ORDER BY created_at DESC LIMIT 1
    ) pe ON true
    LEFT JOIN LATERAL (
      SELECT owner_user_id FROM engagement WHERE person_id = p.id AND status = 'active' ORDER BY created_at DESC LIMIT 1
    ) eng ON true
    LEFT JOIN app_user u ON u.id = eng.owner_user_id
    WHERE p.primary_name ILIKE ${likePattern}
    ORDER BY p.primary_name ASC
    LIMIT 200
  `);

  return rows.map((r) => ({
    personId: r.person_id,
    primaryName: r.primary_name,
    currentEmployer: r.current_employer,
    currentTitle: r.current_title,
    doNotContact: r.do_not_contact,
    ownerName: r.owner_name,
  }));
}

export type CandidateDetail = {
  personId: string;
  primaryName: string;
  doNotContact: boolean;
  dncReason: string | null;
  createdFrom: string;
  identifiers: { type: string; value: string }[];
  employment: { id: string; employerName: string; title: string | null; isCurrent: boolean }[];
};

export async function getCandidateDetail(personId: string): Promise<CandidateDetail | null> {
  const [person] = await db.execute<{
    id: string;
    primary_name: string;
    do_not_contact: boolean;
    dnc_reason: string | null;
    created_from: string;
  }>(sql`SELECT id, primary_name, do_not_contact, dnc_reason, created_from FROM person WHERE id = ${personId}`);
  if (!person) return null;

  const identifiers = await db.execute<{ type: string; value: string }>(
    sql`SELECT type::text, value FROM person_identifier WHERE person_id = ${personId} ORDER BY is_primary DESC`,
  );
  const employment = await db.execute<{ id: string; employer_name: string; title: string | null; is_current: boolean }>(
    sql`SELECT id, employer_name, title, is_current FROM person_employment WHERE person_id = ${personId} ORDER BY is_current DESC, created_at DESC`,
  );

  return {
    personId: person.id,
    primaryName: person.primary_name,
    doNotContact: person.do_not_contact,
    dncReason: person.dnc_reason,
    createdFrom: person.created_from,
    identifiers: identifiers.map((i) => ({ type: i.type, value: i.value })),
    employment: employment.map((e) => ({ id: e.id, employerName: e.employer_name, title: e.title, isCurrent: e.is_current })),
  };
}

export type CandidateEngagement = {
  engagementId: string;
  jobTitle: string;
  clientName: string;
  currentStage: string;
  ownerName: string | null;
  daysInStage: number;
  expectedFee: number | null;
};

export async function getCandidateEngagements(personId: string): Promise<CandidateEngagement[]> {
  const rows = await db.execute<{
    engagement_id: string;
    job_title: string;
    client_name: string;
    current_stage: string;
    owner_name: string | null;
    days_in_stage: number;
    expected_fee: number | null;
  }>(sql`
    SELECT e.id AS engagement_id, j.title AS job_title, b.name AS client_name, e.current_stage,
           u.name AS owner_name, EXTRACT(day FROM now() - e.stage_entered_at)::int AS days_in_stage, e.expected_fee
    FROM engagement e
    JOIN job j ON j.id = e.job_id
    JOIN client c ON c.id = j.client_id
    JOIN brokerage b ON b.id = c.brokerage_id
    LEFT JOIN app_user u ON u.id = e.owner_user_id
    WHERE e.person_id = ${personId}
    ORDER BY e.created_at DESC
  `);

  return rows.map((r) => ({
    engagementId: r.engagement_id,
    jobTitle: r.job_title,
    clientName: r.client_name,
    currentStage: r.current_stage,
    ownerName: r.owner_name,
    daysInStage: Number(r.days_in_stage),
    expectedFee: r.expected_fee !== null ? Number(r.expected_fee) : null,
  }));
}

export type TimelineItem = { occurredAt: Date; kind: string; summary: string };

export async function getCandidateTimeline(personId: string): Promise<TimelineItem[]> {
  const rows = await db.execute<{ occurred_at: Date; kind: string; summary: string }>(sql`
    WITH eng AS (SELECT id FROM engagement WHERE person_id = ${personId})
    SELECT occurred_at, kind, summary FROM (
      SELECT ev.occurred_at, 'event' AS kind, ev.type AS summary
      FROM event ev WHERE ev.entity_type = 'engagement' AND ev.entity_id IN (SELECT id::text FROM eng)
      UNION ALL
      SELECT an.created_at, 'note' AS kind, an.body AS summary
      FROM activity_note an WHERE an.entity_type = 'person' AND an.entity_id = ${personId}
      UNION ALL
      SELECT h.changed_at, 'stage_change' AS kind,
        'Moved to ' || h.to_stage::text || COALESCE(' from ' || h.from_stage::text, '') AS summary
      FROM engagement_stage_history h WHERE h.engagement_id IN (SELECT id FROM eng)
      UNION ALL
      SELECT COALESCE(iv.scheduled_at, iv.created_at), 'interview' AS kind,
        'Interview (' || iv.interview_type::text || ') ' || iv.status::text AS summary
      FROM interview iv WHERE iv.engagement_id IN (SELECT id FROM eng)
    ) combined
    ORDER BY occurred_at DESC
    LIMIT 100
  `);

  return rows.map((r) => ({ occurredAt: r.occurred_at, kind: r.kind, summary: r.summary }));
}
