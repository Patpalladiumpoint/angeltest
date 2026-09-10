#!/usr/bin/env tsx
// Narrow importer (DECISION 4): active engagements and their persons, jobs,
// clients, contracts; placements from the last 24 months with fees,
// invoices, payments, and spreadsheet-calculated commissions staged for
// Phase 2's shadow harness. Deliberately NOT the full historical candidate
// database (DECISION 4's own point: importing everything is what makes
// dedup, search, and data quality unknowable).
//
// Idempotent by construction: every row's external_id becomes both a
// person_identifier(type=legacy_id) match key AND the event/legacy_placement_import
// idempotency key, so re-running this script against the same file is safe
// -- a second pass finds the same person and the same event, updates
// engagement/placement facts if they changed, and inserts nothing new.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { db, withActor, type Actor, type DbTx } from "@/db/client";
import {
  appUser,
  brokerage,
  client,
  clientContract,
  job,
  person,
  personIdentifier,
  personEmployment,
  engagement,
  placement,
  legacyPlacementImport,
  engagementStageEnum,
} from "@/db/schema";
import { parseCsv } from "./csv";
import type { NarrowImportRow, ImportOutcome } from "./types";
import { normalizePersonName, normalizeEmployerString, computeDedupFingerprint, normalizeIdentifier } from "@/identity/normalize";
import { findByIdentifier, enqueueMergeCandidates } from "@/identity/resolver";
import { writeEvent } from "@/events/writer";
import { writeAuditLog } from "@/audit/log";

const VALID_STAGES = new Set(engagementStageEnum.enumValues);

// System actor for import-driven writes -- the "who did this" for
// audit_log/event rows created by a batch job, not a human clicking in the
// UI. A real deploy would seed this once and read its id from env; this
// script resolves-or-creates it so `npm run import:narrow` works against a
// freshly migrated + seeded database with no extra setup step.
async function resolveImportActor(organizationId: string): Promise<Actor> {
  const [existing] = await db.select().from(appUser).where(eq(appUser.email, "import@palladiumpoint.internal")).limit(1);
  if (existing) return { userId: existing.id, role: existing.role };

  const [created] = await db
    .insert(appUser)
    .values({
      organizationId,
      email: "import@palladiumpoint.internal",
      name: "Narrow Importer",
      role: "ops",
    })
    .returning();
  return { userId: created!.id, role: created!.role };
}

async function resolveBrokerage(tx: DbTx, organizationId: string, name: string, rank?: string, rankSource?: string) {
  const normalizedName = normalizeEmployerString(name);
  const [existing] = await tx.select().from(brokerage).where(eq(brokerage.normalizedName, normalizedName)).limit(1);
  if (existing) return existing;

  const [created] = await tx
    .insert(brokerage)
    .values({
      organizationId,
      name,
      normalizedName,
      rank: rank ? Number(rank) : undefined,
      rankSource: rankSource || undefined,
      rankAsOf: rank ? new Date() : undefined,
      isClient: true,
    })
    .returning();
  return created!;
}

async function resolveClient(tx: DbTx, brokerageId: string, tier: NarrowImportRow["client_tier"]) {
  const [existing] = await tx.select().from(client).where(eq(client.brokerageId, brokerageId)).limit(1);
  if (existing) return existing;

  const [created] = await tx
    .insert(client)
    .values({ brokerageId, tier: tier || "standard" })
    .returning();
  return created!;
}

async function resolveContract(tx: DbTx, clientId: string, row: NarrowImportRow) {
  const [existing] = await tx.select().from(clientContract).where(eq(clientContract.clientId, clientId)).limit(1);
  if (existing) return existing;

  const [created] = await tx
    .insert(clientContract)
    .values({
      clientId,
      feeModel: row.contract_fee_model || "contingency",
      feePercent: row.contract_fee_percent ? Number(row.contract_fee_percent) : undefined,
      guaranteeDays: row.contract_guarantee_days ? Number(row.contract_guarantee_days) : 90,
    })
    .returning();
  return created!;
}

async function resolveJob(tx: DbTx, clientId: string, contractId: string, row: NarrowImportRow) {
  const [existing] = await tx
    .select()
    .from(job)
    .where(and(eq(job.clientId, clientId), eq(job.title, row.job_title)))
    .limit(1);
  if (existing) return existing;

  const [created] = await tx
    .insert(job)
    .values({ clientId, contractId, title: row.job_title, status: row.job_status || "open" })
    .returning();
  return created!;
}

async function resolveOwner(tx: DbTx, email: string | undefined): Promise<string | undefined> {
  if (!email) return undefined;
  const [owner] = await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, email)).limit(1);
  return owner?.id;
}

// Identity resolution for one import row (spec 3.2, tier 1 only at import
// time -- the legacy_id and email/phone/linkedin identifiers on the row
// ARE the deterministic signals). Tier 2 (fuzzy) runs afterward via
// enqueueMergeCandidates against the person this settles on, same as any
// other person creation path.
async function resolvePerson(
  tx: DbTx,
  organizationId: string,
  row: NarrowImportRow,
  actor: Actor,
): Promise<{ personId: string; created: boolean }> {
  const legacyIdMatch = await findByIdentifier({ type: "legacy_id", value: row.external_id });
  if (legacyIdMatch) return { personId: legacyIdMatch, created: false };

  for (const [type, value] of [
    ["email", row.person_email],
    ["phone", row.person_phone],
    ["linkedin_url", row.person_linkedin_url],
  ] as const) {
    if (!value) continue;
    const match = await findByIdentifier({ type, value });
    if (match) {
      await attachIdentifierIfMissing(tx, match, "legacy_id", row.external_id);
      return { personId: match, created: false };
    }
  }

  const [created] = await tx
    .insert(person)
    .values({
      organizationId,
      primaryName: row.person_name,
      normalizedNameKey: normalizePersonName(row.person_name),
      dedupFingerprint: computeDedupFingerprint(row.person_name, row.employer_name),
      doNotContact: row.person_do_not_contact === "true",
      dncReason: row.person_dnc_reason || undefined,
      dncSetAt: row.person_do_not_contact === "true" ? new Date() : undefined,
      createdFrom: "narrow_import",
      createdBy: actor.userId,
    })
    .returning();

  await attachIdentifierIfMissing(tx, created!.id, "legacy_id", row.external_id);
  if (row.person_email) await attachIdentifierIfMissing(tx, created!.id, "email", row.person_email);
  if (row.person_phone) await attachIdentifierIfMissing(tx, created!.id, "phone", row.person_phone);
  if (row.person_linkedin_url) await attachIdentifierIfMissing(tx, created!.id, "linkedin_url", row.person_linkedin_url);

  return { personId: created!.id, created: true };
}

async function attachIdentifierIfMissing(
  tx: DbTx,
  personId: string,
  type: "email" | "phone" | "linkedin_url" | "legacy_id",
  value: string,
): Promise<void> {
  const normalizedValue = normalizeIdentifier(type, value);
  const [existing] = await tx
    .select({ id: personIdentifier.id })
    .from(personIdentifier)
    .where(and(eq(personIdentifier.type, type), eq(personIdentifier.normalizedValue, normalizedValue)))
    .limit(1);
  if (existing) return; // already attached to someone (this person or, in principle, another -- deterministic tier already ran)

  await tx.insert(personIdentifier).values({ personId, type, value, normalizedValue, isPrimary: type === "email" });
}

async function importRow(organizationId: string, row: NarrowImportRow, actor: Actor): Promise<ImportOutcome> {
  if (!VALID_STAGES.has(row.engagement_stage as (typeof engagementStageEnum.enumValues)[number])) {
    // Persisted, not just logged: the Phase 1 data quality report's
    // "unmappable stages" line (src/dataquality/report.ts) reads these back.
    // A row that fails validation never reaches a transaction, so this
    // write goes through the plain pool, not withActor -- there is no
    // engagement/person to attach it to yet.
    await writeEvent(db, {
      type: "import.unmappable_stage",
      source: "narrow_import",
      entityType: "import_row",
      entityId: row.external_id,
      payload: { stage: row.engagement_stage, row },
      occurredAt: new Date(),
      externalId: `narrow_import_error:${row.external_id}`,
    });
    return { externalId: row.external_id, status: "error", error: `unknown engagement_stage "${row.engagement_stage}"` };
  }

  try {
    return await withActor(actor, async (tx) => {
      const brokerageRow = await resolveBrokerage(tx, organizationId, row.brokerage_name, row.brokerage_rank, row.brokerage_rank_source);
      const clientRow = await resolveClient(tx, brokerageRow.id, row.client_tier);
      const contractRow = await resolveContract(tx, clientRow.id, row);
      const jobRow = await resolveJob(tx, clientRow.id, contractRow.id, row);

      const { personId, created } = await resolvePerson(tx, organizationId, row, actor);

      if (row.employer_name) {
        const [existingEmployment] = await tx
          .select({ id: personEmployment.id })
          .from(personEmployment)
          .where(and(eq(personEmployment.personId, personId), eq(personEmployment.employerName, row.employer_name)))
          .limit(1);
        if (!existingEmployment) {
          await tx.insert(personEmployment).values({
            personId,
            employerName: row.employer_name,
            title: row.employer_title,
            isCurrent: row.employer_is_current !== "false",
            source: "narrow_import",
          });
        }
      }

      const ownerId = await resolveOwner(tx, row.engagement_owner_email);

      const [existingEngagement] = await tx
        .select()
        .from(engagement)
        .where(and(eq(engagement.personId, personId), eq(engagement.jobId, jobRow.id)))
        .limit(1);

      let engagementId: string;
      if (existingEngagement) {
        engagementId = existingEngagement.id;
        await tx
          .update(engagement)
          .set({
            currentStage: row.engagement_stage as (typeof engagementStageEnum.enumValues)[number],
            ownerUserId: ownerId ?? existingEngagement.ownerUserId,
            expectedFee: row.engagement_expected_fee ? Number(row.engagement_expected_fee) : existingEngagement.expectedFee,
            brokerageRankSnapshot: brokerageRow.rank ?? existingEngagement.brokerageRankSnapshot,
          })
          .where(eq(engagement.id, engagementId));
      } else {
        const [createdEngagement] = await tx
          .insert(engagement)
          .values({
            personId,
            jobId: jobRow.id,
            currentStage: row.engagement_stage as (typeof engagementStageEnum.enumValues)[number],
            ownerUserId: ownerId,
            expectedFee: row.engagement_expected_fee ? Number(row.engagement_expected_fee) : undefined,
            brokerageRankSnapshot: brokerageRow.rank,
            createdBy: actor.userId,
          })
          .returning();
        engagementId = createdEngagement!.id;
      }

      let placementId: string | undefined;
      if (row.placement_start_date) {
        const [existingPlacement] = await tx.select().from(placement).where(eq(placement.engagementId, engagementId)).limit(1);
        if (existingPlacement) {
          placementId = existingPlacement.id;
        } else {
          const [createdPlacement] = await tx
            .insert(placement)
            .values({
              engagementId,
              startDate: new Date(row.placement_start_date),
              feeAmount: row.placement_fee_amount ? Number(row.placement_fee_amount) : undefined,
              status: "started",
            })
            .returning();
          placementId = createdPlacement!.id;
        }

        const [existingStaged] = await tx
          .select({ id: legacyPlacementImport.id })
          .from(legacyPlacementImport)
          .where(eq(legacyPlacementImport.externalId, row.external_id))
          .limit(1);
        if (!existingStaged) {
          await tx.insert(legacyPlacementImport).values({
            externalId: row.external_id,
            engagementId,
            placementId,
            recruiterEmail: row.placement_recruiter_email,
            startDate: new Date(row.placement_start_date),
            feeAmount: row.placement_fee_amount ? Number(row.placement_fee_amount) : undefined,
            invoiceAmount: row.placement_invoice_amount ? Number(row.placement_invoice_amount) : undefined,
            invoiceIssuedAt: row.placement_invoice_issued_at ? new Date(row.placement_invoice_issued_at) : undefined,
            paymentAmount: row.placement_payment_amount ? Number(row.placement_payment_amount) : undefined,
            paymentReceivedAt: row.placement_payment_received_at ? new Date(row.placement_payment_received_at) : undefined,
            legacyCommissionAmount: row.placement_legacy_commission_amount ? Number(row.placement_legacy_commission_amount) : undefined,
            rawRow: row,
          });
        }
      }

      const eventId = await writeEvent(tx, {
        type: existingEngagement ? "engagement.reimported" : "engagement.imported",
        source: "narrow_import",
        entityType: "engagement",
        entityId: engagementId,
        payload: row,
        occurredAt: new Date(),
        externalId: `narrow_import:${row.external_id}`,
      });

      await writeAuditLog(tx, {
        actorUserId: actor.userId,
        action: existingEngagement ? "narrow_import_update" : "narrow_import_create",
        entityType: "engagement",
        entityId: engagementId,
        before: existingEngagement ?? null,
        after: { personId, jobId: jobRow.id, stage: row.engagement_stage },
      });

      let mergeCandidatesEnqueued = 0;
      if (created) {
        mergeCandidatesEnqueued = await enqueueMergeCandidates(organizationId, personId);
      }

      return {
        externalId: row.external_id,
        status: existingEngagement ? "updated" : "created",
        personId,
        engagementId,
        mergeCandidatesEnqueued,
      } satisfies ImportOutcome;
    });
  } catch (err) {
    return { externalId: row.external_id, status: "error", error: (err as Error).message };
  }
}

export async function runNarrowImport(filePath: string, organizationId: string): Promise<ImportOutcome[]> {
  const text = readFileSync(filePath, "utf8");
  const rows = parseCsv(text) as unknown as NarrowImportRow[];
  const actor = await resolveImportActor(organizationId);

  const outcomes: ImportOutcome[] = [];
  for (const row of rows) {
    outcomes.push(await importRow(organizationId, row, actor));
  }
  return outcomes;
}

if (require.main === module) {
  (async () => {
    const [, , fileArg, orgArg] = process.argv;
    if (!fileArg) {
      const fixturesDir = path.join(__dirname, "fixtures");
      const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".csv"));
      if (files.length === 0) throw new Error("no CSV file given and no fixtures found in src/import/fixtures");
      console.log(`No file given -- using fixture(s): ${files.join(", ")}`);
      const [orgRow] = await db.select().from(appUser).limit(1);
      const organizationId = orgArg ?? orgRow?.organizationId;
      if (!organizationId) throw new Error("no organization_id given and none found -- run npm run db:seed first");
      for (const file of files) {
        const outcomes = await runNarrowImport(path.join(fixturesDir, file), organizationId);
        printSummary(file, outcomes);
      }
    } else {
      const [orgRow] = await db.select().from(appUser).limit(1);
      const organizationId = orgArg ?? orgRow?.organizationId;
      if (!organizationId) throw new Error("no organization_id given and none found -- run npm run db:seed first");
      const outcomes = await runNarrowImport(fileArg, organizationId);
      printSummary(fileArg, outcomes);
    }
    process.exit(0);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

function printSummary(file: string, outcomes: ImportOutcome[]): void {
  const counts = outcomes.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`${file}: ${JSON.stringify(counts)}`);
  for (const o of outcomes.filter((o) => o.status === "error")) {
    console.error(`  ERROR ${o.externalId}: ${o.error}`);
  }
}
