#!/usr/bin/env tsx
// Phase 1 week-2 deliverable (spec Phase 1 bullet), expanded per section 17
// of the MVP build directive: unmappable stages, duplicate persons,
// duplicate brokerages, engagements with no owner, engagements with no
// next action, placements with no invoice, missing start dates, impossible
// stage/date combinations, inactive clients with active portal contacts,
// and currently stalled engagements ranked by days idle and expected fee.
// Read-only -- nothing here mutates state. Per the brief's "do not silently
// merge data" rule, nothing here merges anything either; duplicate
// brokerages surface for human review the same way duplicate persons
// already do via the merge queue (see /merge-queue), they just aren't
// wired into person_merge_candidate's auto-merge-adjacent tooling since
// brokerage has no merge workflow yet -- flagged here, acted on manually.
//
// Deliberately NOT wired to the exception/rule-id engine (src/exceptions/
// rules.ts) -- that's the Phase 3 state machine's nightly consistency job
// (spec 5.4), which reuses similar queries but writes `exception` rows and
// runs on a schedule. This is the plain, human-run version the spec calls
// for now, before that engine exists.
import { sql } from "drizzle-orm";
import { db, withActor, type Actor } from "@/db/client";
import { STRONG_FUZZY_MATCH_THRESHOLD } from "@/identity/resolver";

export type DataQualityReport = {
  unmappableStages: { externalId: string; stage: string; occurredAt: Date }[];
  duplicatePersons: { personAId: string; personAName: string; personBId: string; personBName: string; similarity: number }[];
  duplicateBrokerages: { brokerageAId: string; brokerageAName: string; brokerageBId: string; brokerageBName: string; similarity: number }[];
  ownerlessEngagements: { engagementId: string; personName: string; jobTitle: string; stage: string }[];
  missingNextAction: { engagementId: string; personName: string; jobTitle: string; stage: string; ownerName: string | null }[];
  placementsWithoutInvoice: { placementId: string; engagementId: string; personName: string; startDate: Date | null }[];
  missingStartDates: { placementId: string; engagementId: string; personName: string; status: string }[];
  impossibleDateCombinations: { kind: string; entityId: string; personName: string; detail: string }[];
  inactiveClientActiveContacts: { contactId: string; contactName: string; contactEmail: string; clientId: string; brokerageName: string }[];
  stalledEngagements: {
    engagementId: string;
    personName: string;
    jobTitle: string;
    stage: string;
    daysIdle: number;
    expectedFee: number | null;
    riskScore: number;
  }[];
  parseFailures: { documentId: string; filename: string; entityType: string; entityId: string }[];
};

export async function runDataQualityReport(actor: Actor): Promise<DataQualityReport> {
  const unmappableStages = await db.execute<{ external_id: string; stage: string; occurred_at: Date }>(sql`
    SELECT entity_id AS external_id, payload->>'stage' AS stage, occurred_at
    FROM event
    WHERE type = 'import.unmappable_stage'
    ORDER BY occurred_at DESC
  `);

  const duplicatePersons = await db.execute<{
    person_a_id: string;
    person_a_name: string;
    person_b_id: string;
    person_b_name: string;
    similarity: number;
  }>(sql`
    SELECT c.person_a_id, a.primary_name AS person_a_name, c.person_b_id, b.primary_name AS person_b_name, c.similarity
    FROM person_merge_candidate c
    JOIN person a ON a.id = c.person_a_id
    JOIN person b ON b.id = c.person_b_id
    WHERE c.status = 'pending'
    ORDER BY c.similarity DESC
  `);

  // "Probable duplicate companies" (section 17): same pg_trgm approach as
  // duplicatePersons, applied to brokerage.name. There is no
  // brokerage_merge_candidate table (no merge workflow exists for
  // brokerages yet) -- this computes the pairs live rather than reading a
  // staged table, and is a review-only surface (no merge action) until
  // that workflow exists. Reuses the person-merge resolver's strong-match
  // threshold (identity/resolver.ts) so the two surfaces mean the same
  // thing by "probable duplicate."
  const duplicateBrokerages = await db.execute<{
    a_id: string;
    a_name: string;
    b_id: string;
    b_name: string;
    similarity: number;
  }>(sql`
    SELECT a.id AS a_id, a.name AS a_name, b.id AS b_id, b.name AS b_name,
      similarity(a.normalized_name, b.normalized_name) AS similarity
    FROM brokerage a
    JOIN brokerage b ON b.id > a.id
    WHERE similarity(a.normalized_name, b.normalized_name) >= ${STRONG_FUZZY_MATCH_THRESHOLD}
    ORDER BY similarity DESC
    LIMIT 50
  `);

  const ownerlessEngagements = await db.execute<{
    engagement_id: string;
    person_name: string;
    job_title: string;
    stage: string;
  }>(sql`
    SELECT e.id AS engagement_id, p.primary_name AS person_name, j.title AS job_title, e.current_stage AS stage
    FROM engagement e
    JOIN person p ON p.id = e.person_id
    JOIN job j ON j.id = e.job_id
    -- Unlike stalledEngagements/missingNextAction below, this deliberately
    -- does NOT use is_open_engagement_stage() -- an ownerless *secured*
    -- placement is arguably the worst case to miss (nobody attributed for
    -- commission), so placed/secured stay in scope here. Only genuinely
    -- dead (closed-lost) or parked (nurture) engagements are excluded;
    -- nobody needs to be assigned to "own" following up on those.
    WHERE e.owner_user_id IS NULL AND e.status = 'active'
      AND e.current_stage NOT IN (
        'candidate_declined', 'client_rejected', 'palladium_reject', 'withdrawn', 'fell_off',
        'not_interested', 'future_prospect', 'keep_in_touch', 'nurture'
      )
    ORDER BY e.created_at ASC
  `);

  // "Missing next action" (section 17): an active, still-open engagement
  // with no next_action_due_at AND no open task pointed at it has fallen
  // out of every mechanism (the auto-task rules in
  // src/domain/transitions.ts, and manual task creation) that would
  // otherwise keep it moving -- distinct from stalledEngagements below,
  // which flags engagements that HAVE been sitting idle a long time
  // regardless of whether a next action exists. This flags the earlier
  // failure mode: nobody ever set one. Scoped to is_open_engagement_stage()
  // (migration 0018) the same way stalledEngagements is -- a closed-lost or
  // nurture engagement genuinely has no next action, and that's correct,
  // not a gap to flag.
  const missingNextAction = await db.execute<{
    engagement_id: string;
    person_name: string;
    job_title: string;
    stage: string;
    owner_name: string | null;
  }>(sql`
    SELECT e.id AS engagement_id, p.primary_name AS person_name, j.title AS job_title, e.current_stage AS stage, u.name AS owner_name
    FROM engagement e
    JOIN person p ON p.id = e.person_id
    JOIN job j ON j.id = e.job_id
    LEFT JOIN app_user u ON u.id = e.owner_user_id
    WHERE e.status = 'active'
      AND is_open_engagement_stage(e.current_stage)
      AND e.next_action_due_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM task t WHERE t.engagement_id = e.id AND t.completed_at IS NULL)
    ORDER BY e.created_at ASC
  `);

  const missingStartDates = await db.execute<{
    placement_id: string;
    engagement_id: string;
    person_name: string;
    status: string;
  }>(sql`
    SELECT pl.id AS placement_id, pl.engagement_id, p.primary_name AS person_name, pl.status
    FROM placement pl
    JOIN engagement e ON e.id = pl.engagement_id
    JOIN person p ON p.id = e.person_id
    WHERE pl.start_date IS NULL
    ORDER BY pl.created_at DESC
  `);

  // "Impossible stage/date combinations" (section 17): a placement that
  // supposedly started before the candidate was even submitted, or an
  // interview scheduled before the engagement existed. Both are logically
  // impossible and point at bad data entry (wrong record picked, or a
  // backdated field), not a real timeline. Kept to two checks that are
  // unambiguous rather than guessing at every conceivable ordering
  // violation -- a false positive here erodes trust in the whole report.
  const impossiblePlacementDates = await db.execute<{
    placement_id: string;
    person_name: string;
    start_date: Date;
    engagement_created_at: Date;
  }>(sql`
    SELECT pl.id AS placement_id, p.primary_name AS person_name, pl.start_date, e.created_at AS engagement_created_at
    FROM placement pl
    JOIN engagement e ON e.id = pl.engagement_id
    JOIN person p ON p.id = e.person_id
    WHERE pl.start_date IS NOT NULL AND pl.start_date < e.created_at
  `);

  const impossibleInterviewDates = await db.execute<{
    interview_id: string;
    person_name: string;
    scheduled_at: Date;
    engagement_created_at: Date;
  }>(sql`
    SELECT i.id AS interview_id, p.primary_name AS person_name, i.scheduled_at, e.created_at AS engagement_created_at
    FROM interview i
    JOIN engagement e ON e.id = i.engagement_id
    JOIN person p ON p.id = e.person_id
    WHERE i.scheduled_at IS NOT NULL AND i.scheduled_at < e.created_at
  `);

  // "Client portal contact with invalid company relationship" (section 17):
  // client_contact.client_id is a NOT NULL foreign key, so it always
  // resolves -- the real-world failure mode is an active portal contact
  // left attached to a client that has since gone inactive, which would
  // let someone sign in to a portal for a relationship that's closed.
  const inactiveClientActiveContacts = await db.execute<{
    contact_id: string;
    contact_name: string;
    contact_email: string;
    client_id: string;
    brokerage_name: string;
  }>(sql`
    SELECT cc.id AS contact_id, cc.name AS contact_name, cc.email AS contact_email, cc.client_id, b.name AS brokerage_name
    FROM client_contact cc
    JOIN client c ON c.id = cc.client_id
    JOIN brokerage b ON b.id = c.brokerage_id
    WHERE cc.is_active = true AND c.status = 'inactive'
    ORDER BY cc.created_at DESC
  `);

  // "Placement with no invoice" now reads the real invoice table (migration
  // 0013) instead of the Phase-1-era legacy_placement_import placeholder.
  // invoice has table-level SELECT revoked from palladium_app, so this goes
  // through the same SECURITY DEFINER + role-scoped function pattern as the
  // Finance page (migration 0017's placements_missing_invoice_for_actor) --
  // a recruiter running this report sees only their own placements missing
  // an invoice, ops/exec/admin see all of them, same boundary as /finance.
  // The function returns person_name directly (joined server-side) rather
  // than just ids, so this stays one round trip.
  const placementsWithoutInvoice = await withActor(actor, (tx) =>
    tx.execute<{ placement_id: string; engagement_id: string; start_date: Date | null; person_name: string }>(sql`
      SELECT * FROM placements_missing_invoice_for_actor()
    `),
  );

  // "Ranked by days idle and expected fee": a composite risk score (days
  // idle x expected fee) surfaces the engagements where both staleness and
  // dollar value are high, rather than sorting on either alone -- a
  // $200k search idle for 3 days and a $5k search idle for 90 days
  // shouldn't rank above a $150k search idle for 45 days. Excludes every
  // closed stage (won, lost, or nurture) via is_open_engagement_stage()
  // (migration 0018), not just placed/secured -- a client-rejected search
  // sitting untouched for 90 days isn't "stalled," it's finished.
  const stalledEngagements = await db.execute<{
    engagement_id: string;
    person_name: string;
    job_title: string;
    stage: string;
    days_idle: number;
    expected_fee: number | null;
    risk_score: number;
  }>(sql`
    SELECT
      e.id AS engagement_id,
      p.primary_name AS person_name,
      j.title AS job_title,
      e.current_stage AS stage,
      EXTRACT(day FROM now() - e.stage_entered_at)::int AS days_idle,
      e.expected_fee,
      EXTRACT(day FROM now() - e.stage_entered_at) * COALESCE(e.expected_fee, 0) AS risk_score
    FROM engagement e
    JOIN person p ON p.id = e.person_id
    JOIN job j ON j.id = e.job_id
    WHERE e.status = 'active'
      AND is_open_engagement_stage(e.current_stage)
    ORDER BY risk_score DESC
    LIMIT 50
  `);

  const parseFailures = await db.execute<{
    document_id: string;
    filename: string;
    entity_type: string;
    entity_id: string;
  }>(sql`
    SELECT id AS document_id, filename, entity_type, entity_id
    FROM document_file
    WHERE parse_status = 'failed'
    ORDER BY created_at DESC
  `);

  return {
    unmappableStages: unmappableStages.map((r) => ({ externalId: r.external_id, stage: r.stage, occurredAt: r.occurred_at })),
    duplicatePersons: duplicatePersons.map((r) => ({
      personAId: r.person_a_id,
      personAName: r.person_a_name,
      personBId: r.person_b_id,
      personBName: r.person_b_name,
      similarity: Number(r.similarity),
    })),
    duplicateBrokerages: duplicateBrokerages.map((r) => ({
      brokerageAId: r.a_id,
      brokerageAName: r.a_name,
      brokerageBId: r.b_id,
      brokerageBName: r.b_name,
      similarity: Number(r.similarity),
    })),
    ownerlessEngagements: ownerlessEngagements.map((r) => ({
      engagementId: r.engagement_id,
      personName: r.person_name,
      jobTitle: r.job_title,
      stage: r.stage,
    })),
    missingNextAction: missingNextAction.map((r) => ({
      engagementId: r.engagement_id,
      personName: r.person_name,
      jobTitle: r.job_title,
      stage: r.stage,
      ownerName: r.owner_name,
    })),
    placementsWithoutInvoice: placementsWithoutInvoice.map((r) => ({
      placementId: r.placement_id,
      engagementId: r.engagement_id,
      personName: r.person_name,
      startDate: r.start_date,
    })),
    missingStartDates: missingStartDates.map((r) => ({
      placementId: r.placement_id,
      engagementId: r.engagement_id,
      personName: r.person_name,
      status: r.status,
    })),
    impossibleDateCombinations: [
      ...impossiblePlacementDates.map((r) => ({
        kind: "Placement predates engagement",
        entityId: r.placement_id,
        personName: r.person_name,
        detail: `started ${r.start_date.toISOString().slice(0, 10)}, engagement created ${r.engagement_created_at.toISOString().slice(0, 10)}`,
      })),
      ...impossibleInterviewDates.map((r) => ({
        kind: "Interview predates engagement",
        entityId: r.interview_id,
        personName: r.person_name,
        detail: `scheduled ${r.scheduled_at.toISOString().slice(0, 10)}, engagement created ${r.engagement_created_at.toISOString().slice(0, 10)}`,
      })),
    ],
    inactiveClientActiveContacts: inactiveClientActiveContacts.map((r) => ({
      contactId: r.contact_id,
      contactName: r.contact_name,
      contactEmail: r.contact_email,
      clientId: r.client_id,
      brokerageName: r.brokerage_name,
    })),
    stalledEngagements: stalledEngagements.map((r) => ({
      engagementId: r.engagement_id,
      personName: r.person_name,
      jobTitle: r.job_title,
      stage: r.stage,
      daysIdle: Number(r.days_idle),
      expectedFee: r.expected_fee !== null ? Number(r.expected_fee) : null,
      riskScore: Number(r.risk_score),
    })),
    parseFailures: parseFailures.map((r) => ({
      documentId: r.document_id,
      filename: r.filename,
      entityType: r.entity_type,
      entityId: r.entity_id,
    })),
  };
}

if (require.main === module) {
  // Standalone CLI use (no HTTP request, so no signed-in actor) runs as the
  // first active ops/exec/admin user it finds -- the same "see everything"
  // scope /finance and /data-quality give that role, appropriate for an
  // operator running this by hand. Fails loudly rather than silently
  // falling back to an unscoped read if no such user exists.
  db.execute<{ id: string; role: "recruiter" | "ops" | "exec" | "admin" }>(sql`
    SELECT id, role FROM app_user WHERE role IN ('ops', 'exec', 'admin') AND is_active = true ORDER BY created_at ASC LIMIT 1
  `)
    .then(([user]) => {
      if (!user) throw new Error("No active ops/exec/admin user found to run the data quality report as.");
      return runDataQualityReport({ userId: user.id, role: user.role });
    })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
