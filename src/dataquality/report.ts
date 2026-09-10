#!/usr/bin/env tsx
// Phase 1 week-2 deliverable (spec Phase 1 bullet): "Data quality report:
// unmappable stages, duplicate persons, engagements with no owner,
// placements with no invoice, missing start dates, and currently stalled
// engagements ranked by days idle and expected fee." Immediate value at
// zero operational risk -- a read-only report, nothing here mutates state.
//
// Deliberately NOT wired to the exception/rule-id engine (src/exceptions/
// rules.ts) -- that's the Phase 3 state machine's nightly consistency job
// (spec 5.4), which reuses similar queries but writes `exception` rows and
// runs on a schedule. This is the plain, human-run version the spec calls
// for now, before that engine exists.
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export type DataQualityReport = {
  unmappableStages: { externalId: string; stage: string; occurredAt: Date }[];
  duplicatePersons: { personAId: string; personAName: string; personBId: string; personBName: string; similarity: number }[];
  ownerlessEngagements: { engagementId: string; personName: string; jobTitle: string; stage: string }[];
  placementsWithoutInvoice: { placementId: string; engagementId: string; personName: string; startDate: Date | null }[];
  missingStartDates: { placementId: string; engagementId: string; personName: string; status: string }[];
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

export async function runDataQualityReport(): Promise<DataQualityReport> {
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
    WHERE e.owner_user_id IS NULL AND e.status = 'active'
    ORDER BY e.created_at ASC
  `);

  // "Placement with no invoice": Phase 1 has no invoice table yet (that's
  // Phase 2's money spine) -- the only invoice-shaped data that exists is
  // what the narrow importer staged from the legacy spreadsheet
  // (legacy_placement_import.invoice_amount). A placement with no staging
  // row at all, or a staged row with no invoice amount, is what this
  // checks for now; it will point at the real `invoice` table once Phase 2
  // builds it.
  const placementsWithoutInvoice = await db.execute<{
    placement_id: string;
    engagement_id: string;
    person_name: string;
    start_date: Date | null;
  }>(sql`
    SELECT pl.id AS placement_id, pl.engagement_id, p.primary_name AS person_name, pl.start_date
    FROM placement pl
    JOIN engagement e ON e.id = pl.engagement_id
    JOIN person p ON p.id = e.person_id
    LEFT JOIN legacy_placement_import lpi ON lpi.placement_id = pl.id
    WHERE lpi.id IS NULL OR lpi.invoice_amount IS NULL
    ORDER BY pl.created_at DESC
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

  // "Ranked by days idle and expected fee": a composite risk score (days
  // idle x expected fee) surfaces the engagements where both staleness and
  // dollar value are high, rather than sorting on either alone -- a
  // $200k search idle for 3 days and a $5k search idle for 90 days
  // shouldn't rank above a $150k search idle for 45 days.
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
      AND e.current_stage NOT IN ('placed', 'secured')
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
    ownerlessEngagements: ownerlessEngagements.map((r) => ({
      engagementId: r.engagement_id,
      personName: r.person_name,
      jobTitle: r.job_title,
      stage: r.stage,
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
  runDataQualityReport()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
