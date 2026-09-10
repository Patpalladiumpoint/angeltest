import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  bigint,
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

// --- MVP slice: candidates, firms, ownership -------------------------------
// Deliberately the smallest cut of spec section 5 that demonstrates the
// firm's #1 stated problem -- collision -- with no LLM, no email sync, no
// firm resolver, no eligibility/off-limits engine. Those are real later
// phases (1, 2, 5, 6-9), not cut corners pretending to be finished: see
// README "MVP scope" for exactly what this does and does not enforce yet.

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

export const candidates = pgTable("candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  currentTitle: text("current_title"),
  currentFirmRaw: text("current_firm_raw"),
  resolvedFirmId: uuid("resolved_firm_id").references(() => firms.id),
  linkedinUrl: text("linkedin_url"),
  doNotContact: boolean("do_not_contact").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
