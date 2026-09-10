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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Phase 0 scope only: the tables every later phase depends on for identity,
// audit, and runtime config. Candidate/firm/search/financial tables land in
// their own phases per the build order (spec section 10).

export const userRoleEnum = pgEnum("user_role", ["recruiter", "admin"]);

// Two roles, full stop. No permissions matrix — see spec section 5 and the
// working agreement's "resist configurability" rule.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull().default("recruiter"),
  mailboxProvider: text("mailbox_provider"),
  oauthTokenRef: text("oauth_token_ref"),
  dailyEmailCap: integer("daily_email_cap").notNull().default(40),
  timezone: text("timezone").notNull().default("America/New_York"),
  voiceProfile: jsonb("voice_profile"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Single-row config tables (spec 5, "Platform"). Enforced to exactly one row
// by a fixed-id upsert pattern (see systemSettingsSingletonId below), not a
// generic settings framework.
export const systemSettings = pgTable("system_settings", {
  id: integer("id").primaryKey().default(1),
  // Global kill switch (3.1). The send worker must read this every poll.
  outboundEnabled: boolean("outbound_enabled").notNull().default(true),
  // Custody operational state (3.7 / section 9 "Data health": "Last
  // successful backup and last successful restore drill"). Written by
  // src/custody/backup.ts and src/custody/restoreDrill.ts, read by the
  // Data health report once that phase exists.
  lastBackupAt: timestamp("last_backup_at", { withTimezone: true }),
  lastRestoreDrillAt: timestamp("last_restore_drill_at", { withTimezone: true }),
  lastRestoreDrillPassed: boolean("last_restore_drill_passed"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  description: text("description").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

// Append-only audit trail (3.6). UPDATE and DELETE are revoked on this table
// at the database role level in migrations/0002_audit_log_lockdown.sql — do
// not rely on application code alone to enforce that.
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export const SYSTEM_SETTINGS_SINGLETON_ID = 1;

// --- Candidates, firms, ownership -------------------------------------------
// Started as the smallest MVP cut of spec section 5 demonstrating the
// firm's #1 stated problem -- collision -- with no LLM or email sync
// involved. The firm graph/resolver (Phase 1) and eligibility/off-limits
// engine below are now real: firms/firmAliases/firmEvents and the resolver
// in src/firms/resolver.ts. Still not built: eligibility/off-limits gating
// itself (Phase 5), LLM-driven outreach, and email sync -- see README for
// exactly what each phase covers.

export const firmStatusEnum = pgEnum("firm_status", ["active", "acquired", "renamed"]);
export const firmTypeEnum = pgEnum("firm_type", ["brokerage", "carrier", "mga", "other"]);

// Phase 1 (spec section 5, "Firms and clients" / section 7.3 resolver).
// canonicalName is the resolver's exact-match target; parentFirmId lets an
// acquired firm's eligibility roll up to its acquirer without maintaining a
// separate table by hand (spec: "Placement protection is derived too...
// Compute it, do not maintain it by hand" -- same philosophy applies here).
export const firms = pgTable(
  "firms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalName: text("canonical_name").notNull(),
    // Maintained by application code (normalizeEmployerString() in
    // src/firms/resolver.ts) on every insert/update, mirroring how
    // firm_aliases.normalized_alias is populated. The resolver's exact and
    // fuzzy tiers both compare against this, not the raw canonicalName --
    // spec 7.3 step 2a is explicit that the exact match is "on
    // firms.canonical_name normalized."
    normalizedCanonicalName: text("normalized_canonical_name"),
    top100Rank: integer("top100_rank"),
    top100ListYear: integer("top100_list_year"),
    // Reporting figure from the Top 100 list, in whole US dollars. Not part
    // of the spec 3.8 money-integrity guardrail (that's specifically
    // invoices/commissions/placements) -- this is informational data about
    // a firm, not a transaction, so it deliberately doesn't use the Cents
    // branded type.
    usBrokerageRevenueDollars: bigint("us_brokerage_revenue_dollars", { mode: "number" }),
    status: firmStatusEnum("status").notNull().default("active"),
    firmType: firmTypeEnum("firm_type").notNull().default("brokerage"),
    parentFirmId: uuid("parent_firm_id").references((): AnyPgColumn => firms.id),
    website: text("website"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("firms_normalized_name_unique_idx")
      .on(table.normalizedCanonicalName)
      .where(sql`${table.normalizedCanonicalName} IS NOT NULL`),
  ],
);

export const firmAliasTypeEnum = pgEnum("firm_alias_type", [
  "dba",
  "former_name",
  "abbreviation",
  "misspelling",
]);

// The resolver's second-tier match (spec 7.3 step 2b, confidence 0.95).
// normalizedAlias is precomputed at seed/insert time by the same
// normalizeEmployerString() the resolver runs on incoming strings, so the
// comparison is normalized-to-normalized, not normalized-to-raw.
export const firmAliases = pgTable(
  "firm_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    alias: text("alias").notNull(),
    aliasType: firmAliasTypeEnum("alias_type").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
  },
  (table) => [uniqueIndex("firm_aliases_normalized_unique_idx").on(table.normalizedAlias)],
);

export const firmEventTypeEnum = pgEnum("firm_event_type", ["acquired_by", "renamed", "merged"]);

// M&A/rebrand history (spec 7.3 step 3, "walk firm_events for acquisitions
// and rebrands"). counterpartyFirmId is the acquirer/new-name firm; the
// resolver walks acquired_by edges to the current owner and applies the
// OQ 2 eligibility-transition rule against announcedAt/effectiveAt.
export const firmEvents = pgTable(
  "firm_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    eventType: firmEventTypeEnum("event_type").notNull(),
    counterpartyFirmId: uuid("counterparty_firm_id").references(() => firms.id),
    announcedAt: timestamp("announced_at", { withTimezone: true }),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    sourceUrl: text("source_url"),
  },
  (table) => [index("firm_events_firm_idx").on(table.firmId)],
);

export const candidateSourceEnum = pgEnum("candidate_source", [
  "sourced",
  "referral",
  "inbound",
  "migrated",
]);

// firm_resolution_method mirrors resolver.ts's ResolutionMethod, plus
// "manual" for when a human picked the firm directly from the dropdown
// instead of accepting (or in place of) the resolver's suggestion.
export const firmResolutionMethodEnum = pgEnum("firm_resolution_method", [
  "exact",
  "alias",
  "fuzzy",
  "manual",
]);

// Phase 3 fields beyond the MVP cut. Deliberately still missing
// eligibility_status/eligibility_reason from the full spec 5 table -- those
// require the Phase 8 eligibility engine (Top 100 + off-limits gate) to
// mean anything; adding empty columns for a computation that doesn't exist
// yet would be a misleading placeholder, not a head start.
export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    preferredName: text("preferred_name"),
    currentTitle: text("current_title"),
    currentFirmRaw: text("current_firm_raw"),
    resolvedFirmId: uuid("resolved_firm_id").references(() => firms.id),
    // Populated by src/firms/resolver.ts (resolveFirm()) on create/edit when
    // resolvedFirmId wasn't picked by hand -- "manual" + 1.0 when it was.
    // Null resolvedFirmId with a non-null method means the resolver ran but
    // requiresManualConfirmation() was true, so nothing was auto-applied.
    firmResolutionConfidence: doublePrecision("firm_resolution_confidence"),
    firmResolutionMethod: firmResolutionMethodEnum("firm_resolution_method"),
    specialty: text("specialty"),
    location: text("location"),
    timezone: text("timezone"),
    seniority: text("seniority"),
    linkedinUrl: text("linkedin_url"),
    source: candidateSourceEnum("source").notNull().default("sourced"),
    summary: text("summary"),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    dncReason: text("dnc_reason"),
    dncSetAt: timestamp("dnc_set_at", { withTimezone: true }),
    // Soft merge (spec 3.6: "Merges and deletions are soft and reversible
    // for 90 days"). A non-null value means this row is the "loser" of a
    // merge; its own data stays intact for the reversibility window rather
    // than being deleted or overwritten.
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => candidates.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // search_vector (tsvector, spec 5) is deliberately NOT modeled here.
    // It's a Postgres GENERATED ALWAYS AS ... STORED column maintained
    // entirely by the database (migrations/0005) -- application code never
    // writes it and only ever reads through it via the raw
    // websearch_to_tsquery() match in listCandidates() (src/candidates/
    // queries.ts), so there's no drizzle-orm column type for it to get
    // right or wrong.
  },
  (table) => [index("candidates_merged_into_idx").on(table.mergedIntoId)],
);

export const claimStatusEnum = pgEnum("claim_status", ["active", "released"]);
export const claimBasisEnum = pgEnum("claim_basis", ["first_touch", "manual_override"]);

// One active claim per candidate (spec 8.2). The partial unique index below
// is the actual enforcement -- it holds under concurrent claim attempts,
// which a `SELECT then INSERT` check in application code would not.
export const candidateClaims = pgTable(
  "candidate_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    claimBasis: claimBasisEnum("claim_basis").notNull().default("first_touch"),
    status: claimStatusEnum("status").notNull().default("active"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
  },
  (table) => [
    uniqueIndex("candidate_claims_one_active_idx")
      .on(table.candidateId)
      .where(sql`${table.status} = 'active'`),
  ],
);

// The collision firewall (spec 8.2, "Global cooldown independent of
// ownership"): every outbound touch by anyone, checked before the next one
// is allowed. This MVP only logs manual touches (call/email/linkedin/note)
// via the UI -- there is no real send pipeline yet (Phases 6-13).
export const contactChannelEnum = pgEnum("contact_channel", ["call", "email", "linkedin", "note"]);

export const contactLedger = pgTable("contact_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id")
    .notNull()
    .references(() => candidates.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  channel: contactChannelEnum("channel").notNull(),
  outcome: text("outcome"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export const GLOBAL_CONTACT_COOLDOWN_DAYS = 90;

// --- Phase 3: engagements, documents, activities ---------------------------

export const engagementTypeEnum = pgEnum("engagement_type", ["retained", "contingent", "consulting"]);
export const engagementStatusEnum = pgEnum("engagement_status", ["active", "completed", "lapsed"]);
export const offLimitsScopeEnum = pgEnum("off_limits_scope", [
  "firm_wide",
  "division",
  "named_individuals",
  "none",
]);

// Client engagements (spec 5, "Firms and clients"). This is the record only
// -- Phase 3 scope is "firm and engagement records," not the enforcement
// gate. off_limits_scope/off_limits_expires_at are captured here now
// because they're just data about the engagement, but nothing yet reads
// them to actually block a claim or a send: that gate (spec 8.1,
// "candidates at this firm are off-limits because of this engagement") is
// explicitly Phase 5 work. Wiring it in early would mean guessing at how
// Phase 5's eligibility pipeline wants to consume it.
export const engagements = pgTable("engagements", {
  id: uuid("id").primaryKey().defaultRandom(),
  firmId: uuid("firm_id")
    .notNull()
    .references(() => firms.id),
  engagementType: engagementTypeEnum("engagement_type").notNull().default("retained"),
  status: engagementStatusEnum("status").notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  offLimitsScope: offLimitsScopeEnum("off_limits_scope").notNull().default("firm_wide"),
  offLimitsExpiresAt: timestamp("off_limits_expires_at", { withTimezone: true }),
  termsNotes: text("terms_notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentTypeEnum = pgEnum("document_type", ["resume", "attachment", "note_file"]);
export const documentParseStatusEnum = pgEnum("document_parse_status", [
  "pending",
  "parsed",
  "failed",
  "not_applicable",
]);

// Spec 3.7 + 5: "Documents in S3-compatible storage... Never on the app
// filesystem." Phase 3 scope is upload and view only -- parseStatus stays
// "pending" (or "not_applicable" for non-resume attachments) until Phase 7
// wires up actual text extraction. extractedText is nullable and unused
// until then; the column exists now because it's part of the one documents
// table the spec defines, not because anything populates it yet.
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    docType: documentTypeEnum("doc_type").notNull(),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    version: integer("version").notNull().default(1),
    parsedAt: timestamp("parsed_at", { withTimezone: true }),
    parseStatus: documentParseStatusEnum("parse_status").notNull().default("pending"),
    extractedText: text("extracted_text"),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("documents_candidate_idx").on(table.candidateId)],
);

export const activityTypeEnum = pgEnum("activity_type", [
  "call",
  "note",
  "meeting",
  "email",
  "linkedin",
  "stage_change",
  "system",
]);
export const activityDirectionEnum = pgEnum("activity_direction", ["inbound", "outbound"]);

// The unified timeline (spec 5: "activities... calls, notes, meetings,
// emails, messages, all on one timeline"). Distinct from contact_ledger:
// contact_ledger is the lean collision-check table (candidate_id, user_id,
// channel, occurred_at -- just enough to answer "did anyone touch this
// person recently"), activities is the rich human-readable record with a
// subject/body. Logging a contact writes both (see
// src/candidates/actions.ts) rather than trying to derive one from the
// other. searchId/emailThreadId/providerMessageId stay null until Phases
// 4 and 6 exist to populate them.
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    searchId: uuid("search_id"), // FK added once `searches` exists (Phase 4)
    userId: uuid("user_id").references(() => users.id),
    activityType: activityTypeEnum("activity_type").notNull(),
    direction: activityDirectionEnum("direction"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    subject: text("subject"),
    body: text("body"),
    emailThreadId: text("email_thread_id"),
    providerMessageId: text("provider_message_id"),
    isAutoCaptured: boolean("is_auto_captured").notNull().default(false),
  },
  (table) => [index("activities_candidate_occurred_idx").on(table.candidateId, table.occurredAt)],
);
