import { desc, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import { engagement, placement, invoice, candidate, job, client, event, syncRecord } from "./schema";
import { crelateAdapter } from "@/adapters/crelate";
import { quickbooksAdapter } from "@/adapters/quickbooks";
import type { HealthCheckResult } from "@/adapters/types";

// Spec section 7, Phase 0: "Reconciliation dashboard showing every data
// quality problem found: engagements with no owner, placements with no
// invoice, invoices with no placement, stage values that do not map,
// duplicate candidates." One query function per finding, each returning
// real rows against the schema -- there is no seeded/live data pulled from
// Crelate or QuickBooks yet in this environment (see README), so these
// will mostly return empty until a real pull runs; that emptiness is
// itself honest, not a placeholder.

export async function engagementsWithNoOwner() {
  return db
    .select({
      engagementId: engagement.id,
      candidateName: candidate.name,
      jobTitle: job.title,
      clientName: client.name,
      currentStage: engagement.currentStage,
    })
    .from(engagement)
    .innerJoin(candidate, sql`${engagement.candidateId} = ${candidate.id}`)
    .innerJoin(job, sql`${engagement.jobId} = ${job.id}`)
    .innerJoin(client, sql`${job.clientId} = ${client.id}`)
    .where(isNull(engagement.ownerUserId));
}

export async function placementsWithNoInvoice() {
  const rows = await db
    .select({
      placementId: placement.id,
      engagementId: placement.engagementId,
      status: placement.status,
      feeAmount: placement.feeAmount,
    })
    .from(placement)
    .leftJoin(invoice, sql`${invoice.placementId} = ${placement.id}`)
    .where(isNull(invoice.id));
  return rows;
}

export async function placementsWithNoFee() {
  return db
    .select({ placementId: placement.id, engagementId: placement.engagementId, status: placement.status })
    .from(placement)
    .where(isNull(placement.feeAmount));
}

export async function invoicesWithNoPlacement() {
  return db
    .select({ invoiceId: invoice.id, quickbooksId: invoice.quickbooksId, amount: invoice.amount, status: invoice.status })
    .from(invoice)
    .where(isNull(invoice.placementId));
}

export async function duplicateCandidates() {
  // Same normalization spirit as the old repo's firm resolver (lowercase,
  // trim) -- deliberately simple here (exact match on name+employer after
  // normalizing whitespace/case). Fuzzy/email-first dedupe is Phase 2 scope
  // (spec 7.2's migration-scale pipeline); this is the Phase 0 finding, not
  // the fix.
  const rows = await db.execute<{
    normalized_name: string;
    normalized_employer: string | null;
    candidate_count: number;
    candidate_ids: string[];
  }>(sql`
    SELECT
      lower(trim(name)) AS normalized_name,
      lower(trim(coalesce(current_employer, ''))) AS normalized_employer,
      count(*)::int AS candidate_count,
      array_agg(id) AS candidate_ids
    FROM candidate
    GROUP BY 1, 2
    HAVING count(*) > 1
  `);
  return rows;
}

export interface StageMappingResult {
  applicable: boolean;
  note: string;
  unmappedStages: string[];
}

export async function stageValuesThatDoNotMap(): Promise<StageMappingResult> {
  // The declarative stage config (spec 4.1) that would validate
  // engagement.current_stage against a real enum doesn't exist until
  // Phase 2. Reporting a guessed stage list here would be exactly the kind
  // of invented contract hard rule 1 warns against for external systems --
  // same principle applies to an internal config that hasn't been built
  // yet. So: report that this check is not yet applicable, not a fake
  // result.
  return {
    applicable: false,
    note:
      "Stage config (spec 4.1) ships in Phase 2. This check will validate " +
      "engagement.current_stage against it once that config exists.",
    unmappedStages: [],
  };
}

export async function integrationHealth(): Promise<HealthCheckResult[]> {
  return Promise.all([crelateAdapter.healthCheck(), quickbooksAdapter.healthCheck()]);
}

export async function recentAdapterFailures(limit = 20) {
  return db
    .select()
    .from(event)
    .where(inArray(event.type, ["adapter_pull_failed", "integration_blocked"]))
    .orderBy(desc(event.occurredAt))
    .limit(limit);
}

export async function driftedSyncRecords() {
  return db.select().from(syncRecord).where(sql`${syncRecord.driftDetectedAt} IS NOT NULL`);
}
