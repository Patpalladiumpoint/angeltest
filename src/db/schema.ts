import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  bigint,
  doublePrecision,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Palladium OS MVP, Phase 1 (foundation and narrow import) schema. Section 3
// of the spec presents the data model as one unit; Phase 1 lays down every
// table in 3.1 (core) and 3.3 (process) because they're what the narrow
// importer (DECISION 4) needs to write into, and because "migrations only,
// no manual schema changes" makes getting the shape right up front cheaper
// than bolting it on later. What's deliberately NOT here: the 3.4 money
// ledger (fee/invoice/payment/commission_plan_version/commission_entry) --
// that's Phase 2's "money spine," built from the legacy_commission_import
// staging table below once the commission engine and shadow harness exist
// (DECISION 6). Phase 1 imports the historical facts; Phase 2 calculates
// and reconciles them.

// --- Organization and users -------------------------------------------------

export const organization = pgTable("organization", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ORGANIZATION_SINGLETON_NOTE =
  "Single-row config table (spec 3.1). Enforced by convention (one seeded row) -- see src/db/seed.ts.";

// Section 8 permissions matrix: three roles, full stop. Row level security
// (0007_permissions_rls.sql) enforces the restrictions in that table --
// recruiters cannot read others' commission or a client's fee percent --
// this enum just names the role a session authenticates as.
export const userRoleEnum = pgEnum("app_user_role", ["recruiter", "ops", "exec"]);

// "user" is a reserved word in Postgres; the table is named app_user to
// avoid quoting it everywhere. active_commission_plan_id is added by Phase
// 2's migration once commission_plan_version exists -- see that phase's
// migration notes.
export const appUser = pgTable("app_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organization.id),
  authUserId: uuid("auth_user_id").unique(), // Supabase auth.users.id once wired to a real project
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull().default("recruiter"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Person: canonical human record (spec 3.1, 3.2) -------------------------
// "The same human is a candidate on one search, a client contact on another,
// and a referral source on a third. One person, many roles." Not
// deferrable -- it's the single most expensive thing to change later.

export const person = pgTable(
  "person",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    primaryName: text("primary_name").notNull(),
    // Maintained by src/identity/normalize.ts on every insert/update -- the
    // deterministic-match tier's exact-match target (spec 3.2 step 1 is
    // identifier-based, but normalizedNameKey backs the fuzzy tier's
    // "matching current employer" comparison and the merge queue's display).
    normalizedNameKey: text("normalized_name_key").notNull(),
    // A cheap collision-narrowing key (e.g. normalized name + first 3 chars
    // of current employer) so the fuzzy match query in
    // src/identity/resolver.ts doesn't have to pg_trgm-compare against the
    // whole table -- narrows candidates before the expensive similarity()
    // call. Recomputed whenever primaryName or current employment changes.
    dedupFingerprint: text("dedup_fingerprint"),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    dncReason: text("dnc_reason"),
    dncSetAt: timestamp("dnc_set_at", { withTimezone: true }),
    // Where this row came from: 'narrow_import', 'manual', 'merge_survivor'.
    // Free text, not an enum -- import sources will grow (spec section 10)
    // and this is provenance metadata, not a business rule.
    createdFrom: text("created_from").notNull().default("manual"),
    // Section 6: "MVP records retention_reviewed_at so the [retention] job
    // can be added later without losing the ability to identify stale
    // records." Deliberately unpopulated by any automated job in Phase 1.
    retentionReviewedAt: timestamp("retention_reviewed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("person_normalized_name_idx").on(table.normalizedNameKey),
    index("person_dedup_fingerprint_idx").on(table.dedupFingerprint),
  ],
);

export const personIdentifierTypeEnum = pgEnum("person_identifier_type", [
  "email",
  "phone",
  "linkedin_url",
  "legacy_id",
]);

// Deterministic-match tier (spec 3.2 step 1): "Deterministic match on any
// normalized person_identifier. Email and LinkedIn URL are near-certain.
// Auto-merge." The UNIQUE(type, normalized_value) constraint IS that tier --
// an insert that would collide is the match, not a query the app has to get
// right every time.
export const personIdentifier = pgTable(
  "person_identifier",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    type: personIdentifierTypeEnum("type").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("person_identifier_type_normalized_unique_idx").on(table.type, table.normalizedValue),
    index("person_identifier_person_idx").on(table.personId),
  ],
);

// --- Brokerage, client, contract, job, engagement, placement ---------------

// spec 3.1: "brokerage.rank is operationally load-bearing. The firm only
// contacts candidates inside the top 100 brokerages. Store rank with
// rank_as_of and snapshot it onto the engagement at sourcing time so
// eligibility stays auditable when rankings shift."
export const brokerage = pgTable(
  "brokerage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    rank: integer("rank"),
    rankSource: text("rank_source"),
    rankAsOf: timestamp("rank_as_of", { withTimezone: true }),
    isClient: boolean("is_client").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("brokerage_normalized_name_unique_idx").on(table.normalizedName)],
);

export const personEmploymentSourceEnum = pgEnum("person_employment_source", [
  "narrow_import",
  "manual",
  "resume_parse",
]);

export const personEmployment = pgTable(
  "person_employment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    employerName: text("employer_name").notNull(),
    brokerageId: uuid("brokerage_id").references(() => brokerage.id),
    title: text("title"),
    isCurrent: boolean("is_current").notNull().default(true),
    // Section 8: candidate comp data access is restricted and audited on
    // read. See src/compensation/reads.ts and 0007_permissions_rls.sql --
    // direct SELECT on this column is revoked from the app role; reads go
    // through a SECURITY DEFINER function that writes audit_log.
    comp: jsonb("comp"),
    bookOfBusiness: jsonb("book_of_business"),
    source: personEmploymentSourceEnum("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("person_employment_person_idx").on(table.personId)],
);

// spec 3.2 step 2: "Strong fuzzy match: pg_trgm name similarity plus
// matching current employer. Surface in a merge review queue. Never
// auto-merge." Merges are reversible (reversedAt) and never destructive --
// absorbedSnapshot holds the full pre-merge state of the absorbed person
// plus its identifiers/employment, so a reversal doesn't have to
// reconstruct anything.
export const personMerge = pgTable(
  "person_merge",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    survivingPersonId: uuid("surviving_person_id")
      .notNull()
      .references(() => person.id),
    absorbedPersonId: uuid("absorbed_person_id")
      .notNull()
      .references(() => person.id),
    absorbedSnapshot: jsonb("absorbed_snapshot").notNull(),
    mergedBy: uuid("merged_by").references(() => appUser.id),
    mergedAt: timestamp("merged_at", { withTimezone: true }).notNull().defaultNow(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => appUser.id),
  },
  (table) => [index("person_merge_surviving_idx").on(table.survivingPersonId)],
);

export const clientTierEnum = pgEnum("client_tier", ["strategic", "standard", "prospect"]);
export const clientStatusEnum = pgEnum("client_status", ["active", "inactive"]);

export const client = pgTable("client", {
  id: uuid("id").primaryKey().defaultRandom(),
  brokerageId: uuid("brokerage_id")
    .notNull()
    .references(() => brokerage.id),
  tier: clientTierEnum("tier").notNull().default("standard"),
  ownerUserId: uuid("owner_user_id").references(() => appUser.id),
  status: clientStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feeModelEnum = pgEnum("fee_model", ["contingency", "retained", "hourly"]);
export const feeBasisEnum = pgEnum("fee_basis", ["first_year_cash", "total_comp", "flat"]);

// section 8: recruiters cannot see feePercent. Enforced by column-level
// privilege revocation in 0007_permissions_rls.sql, not just a UI omission.
export const clientContract = pgTable("client_contract", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => client.id),
  feeModel: feeModelEnum("fee_model").notNull().default("contingency"),
  feePercent: doublePrecision("fee_percent"),
  feeBasis: feeBasisEnum("fee_basis").notNull().default("first_year_cash"),
  guaranteeDays: integer("guarantee_days").notNull().default(90),
  paymentTermsDays: integer("payment_terms_days").notNull().default(30),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobStatusEnum = pgEnum("job_status", ["open", "on_hold", "filled", "cancelled"]);

export const job = pgTable("job", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => client.id),
  contractId: uuid("contract_id").references(() => clientContract.id),
  title: text("title").notNull(),
  status: jobStatusEnum("status").notNull().default("open"),
  feeOverride: doublePrecision("fee_override"),
  targetCompRangeMin: integer("target_comp_range_min"),
  targetCompRangeMax: integer("target_comp_range_max"),
  ownerUserId: uuid("owner_user_id").references(() => appUser.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Section 5 DECISION 2: nine stages, interview rounds as events inside
// client_process rather than their own stages. The state machine ENGINE
// (auto-generated tasks, SLA breach exceptions, transition guards -- spec
// 5.2/5.3) is Phase 3 scope; this column exists in Phase 1 so the narrow
// importer has somewhere to put each imported engagement's current stage.
// No automation reads or writes it yet beyond the importer and manual edits.
export const engagementStageEnum = pgEnum("engagement_stage", [
  "sourced",
  "outreach",
  "engaged",
  "qualified",
  "submitted",
  "client_process",
  "offer",
  "placed",
  "secured",
  "candidate_declined",
  "client_rejected",
  "withdrawn",
  "on_hold",
  "fell_off",
]);

export const engagementStatusEnum = pgEnum("engagement_status", ["active", "closed"]);

export const engagement = pgTable(
  "engagement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id),
    currentStage: engagementStageEnum("current_stage").notNull().default("sourced"),
    stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
    ownerUserId: uuid("owner_user_id").references(() => appUser.id),
    sourcerUserId: uuid("sourcer_user_id").references(() => appUser.id),
    status: engagementStatusEnum("status").notNull().default("active"),
    roundNumber: integer("round_number").notNull().default(0),
    roundsExpected: integer("rounds_expected"),
    nextActionDueAt: timestamp("next_action_due_at", { withTimezone: true }),
    expectedFee: doublePrecision("expected_fee"),
    // Snapshotted from brokerage.rank at sourcing time (spec 3.1) so
    // eligibility stays auditable when the Top 100 list is refreshed later.
    brokerageRankSnapshot: integer("brokerage_rank_snapshot"),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("engagement_person_job_unique_idx").on(table.personId, table.jobId),
    index("engagement_owner_idx").on(table.ownerUserId),
    index("engagement_stage_idx").on(table.currentStage),
  ],
);

export const placementStatusEnum = pgEnum("placement_status", ["pending_start", "started", "fell_off", "secured"]);

// spec 3.1 groups placement with engagement, not with the 3.4 money ledger
// -- it's the fact of a placement and its agreed terms, not the fee/invoice/
// payment/commission ledger itself (Phase 2). fee_amount here is the
// agreed placement fee; fee.gross_amount (Phase 2) is the recognized ledger
// entry derived from it.
export const placement = pgTable("placement", {
  id: uuid("id").primaryKey().defaultRandom(),
  engagementId: uuid("engagement_id")
    .notNull()
    .unique()
    .references(() => engagement.id),
  startDate: timestamp("start_date", { withTimezone: true }),
  guaranteedThrough: timestamp("guaranteed_through", { withTimezone: true }),
  acceptedComp: jsonb("accepted_comp"),
  feeAmount: doublePrecision("fee_amount"),
  feeCalcSnapshot: jsonb("fee_calc_snapshot"),
  status: placementStatusEnum("status").notNull().default("pending_start"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Process tables: event, task, exception, audit_log, activity_note ------
// Spec 3.3: "not deferrable -- missing events cannot be invented later."
// event is the spine every inbound signal becomes before anything else
// happens. task/exception/activity_note are created here as schema now
// (cheap, and 3.3 groups them as one non-deferrable unit) but nothing
// generates or reads them yet in Phase 1 beyond the narrow importer
// occasionally writing an activity_note -- the state machine (task
// auto-generation, SLA exceptions) is Phase 3.

export const eventSourceEnum = pgEnum("event_source", [
  "narrow_import",
  "manual_ui",
  "email_ingest",
  "calendar_sync",
  "system",
]);

// Append-only, same lockdown pattern as audit_log (0005_process_tables.sql
// REVOKEs UPDATE/DELETE and adds a trigger). external_id backs the
// idempotency requirement -- an import or a webhook can retry safely.
export const event = pgTable(
  "event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    source: eventSourceEnum("source").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    externalId: text("external_id"),
  },
  (table) => [
    uniqueIndex("event_external_id_unique_idx").on(table.externalId).where(sql`${table.externalId} IS NOT NULL`),
    index("event_entity_idx").on(table.entityType, table.entityId),
    index("event_occurred_at_idx").on(table.occurredAt),
  ],
);

export const taskTypeEnum = pgEnum("task_type", ["manual", "system_generated"]);

export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id").references(() => engagement.id),
    type: text("type").notNull(),
    taskKind: taskTypeEnum("task_kind").notNull().default("manual"),
    assigneeUserId: uuid("assignee_user_id").references(() => appUser.id),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => appUser.id),
    autoGenerated: boolean("auto_generated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("task_engagement_idx").on(table.engagementId)],
);

export const exceptionSeverityEnum = pgEnum("exception_severity", ["low", "medium", "high"]);

export const exception = pgTable(
  "exception",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: text("rule_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    severity: exceptionSeverityEnum("severity").notNull().default("medium"),
    revenueAtRisk: doublePrecision("revenue_at_risk"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  },
  (table) => [index("exception_entity_idx").on(table.entityType, table.entityId)],
);

// Append-only, same lockdown as event (0005). "Cannot reconstruct who did
// what" -- section 0's own worked example of a non-deferrable item.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => appUser.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
    index("audit_log_at_idx").on(table.at),
  ],
);

export const activityNote = pgTable(
  "activity_note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    authorUserId: uuid("author_user_id").references(() => appUser.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("activity_note_entity_idx").on(table.entityType, table.entityId)],
);

// --- Documents ---------------------------------------------------------------

export const documentKindEnum = pgEnum("document_kind", [
  "resume",
  "contract",
  "submittal",
  "transcript",
  "other",
]);
export const documentParseStatusEnum = pgEnum("document_parse_status", [
  "pending",
  "parsed",
  "failed",
  "not_applicable",
]);

// Supabase Storage, signed URLs only (spec section 2, section 6). storagePath
// is the object key inside the documents bucket; the app never serves a
// public URL -- see src/storage/documents.ts.
export const documentFile = pgTable(
  "document_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    storagePath: text("storage_path").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    kind: documentKindEnum("kind").notNull(),
    parsedProfile: jsonb("parsed_profile"),
    parseStatus: documentParseStatusEnum("parse_status").notNull().default("pending"),
    checksumSha256: text("checksum_sha256").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => appUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("document_file_entity_idx").on(table.entityType, table.entityId)],
);

// --- Phase 1 import staging (additive, not part of spec section 3) ---------
// DECISION 4 requires importing "placements from the last 24 months with
// their fees, invoices, payments, and spreadsheet-calculated commissions...
// needed for the shadow harness." DECISION 6 assigns building the actual
// commission engine and its plan_version/commission_entry ledger to Phase
// 2 ("derive commission rules from history, do not collect them up front").
// A real commission_entry row requires a commission_plan_version, which
// doesn't exist until Phase 2 encodes one -- so Phase 1 stages the raw
// historical facts here instead of forcing them into a ledger shape that
// isn't buildable yet. Phase 2 reads this table once, populates the real
// fee/invoice/payment/commission_entry tables from it, and the shadow
// harness diffs against legacyCommissionAmount. Disposable once Phase 2 has
// consumed it -- passes DECISION 0's own test (backfillable, cut/replace
// freely) unlike anything in spec section 3.
export const legacyPlacementImport = pgTable(
  "legacy_placement_import",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalId: text("external_id").notNull().unique(),
    engagementId: uuid("engagement_id").references(() => engagement.id),
    placementId: uuid("placement_id").references(() => placement.id),
    recruiterEmail: text("recruiter_email"),
    startDate: timestamp("start_date", { withTimezone: true }),
    acceptedComp: jsonb("accepted_comp"),
    feeAmount: doublePrecision("fee_amount"),
    invoiceAmount: doublePrecision("invoice_amount"),
    invoiceIssuedAt: timestamp("invoice_issued_at", { withTimezone: true }),
    paymentAmount: doublePrecision("payment_amount"),
    paymentReceivedAt: timestamp("payment_received_at", { withTimezone: true }),
    legacyCommissionAmount: doublePrecision("legacy_commission_amount"),
    rawRow: jsonb("raw_row").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("legacy_placement_import_engagement_idx").on(table.engagementId)],
);

// --- Client portal (additive, see 0009_client_contact.sql) -----------------
// A distinct identity space from appUser -- a client contact is never a
// recruiter/ops/exec. See the migration's comment for how scoping and the
// money-column lockdown both hold for this new surface.

export const clientContact = pgTable(
  "client_contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("client_contact_client_idx").on(table.clientId)],
);

// --- Merge review queue (additive, see 0008_person_merge_candidate.sql) ----

export const personMergeCandidateStatusEnum = pgEnum("person_merge_candidate_status", [
  "pending",
  "merged",
  "rejected",
]);

export const personMergeCandidate = pgTable(
  "person_merge_candidate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personAId: uuid("person_a_id")
      .notNull()
      .references(() => person.id),
    personBId: uuid("person_b_id")
      .notNull()
      .references(() => person.id),
    similarity: doublePrecision("similarity").notNull(),
    matchedOn: text("matched_on").notNull(),
    status: personMergeCandidateStatusEnum("status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => appUser.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("person_merge_candidate_pair_unique_idx").on(table.personAId, table.personBId),
    index("person_merge_candidate_status_idx").on(table.status),
  ],
);
