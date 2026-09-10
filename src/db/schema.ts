import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  numeric,
  date,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Phase 0 scope only ("Mirror and prove", spec section 7): identity, audit,
// and the read-only mirror + reconciliation tables. Money spine (Phase 1),
// the engagement state machine config validation (Phase 2), and knowledge
// tables (Phase 3) are not built here -- see migration file headers for why
// each deferred column was left out rather than guessed at.

export const userRoleEnum = pgEnum("user_role", ["recruiter", "ops", "exec"]);

export const organization = pgTable("organization", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull(),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ORGANIZATION_SINGLETON_ID = 1;

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull().default("recruiter"),
  // FK to commission_plan(id) once that table exists (Phase 1) -- see
  // 0001_init.sql for why it's unconstrained today.
  commissionPlanId: uuid("commission_plan_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Hard rule 7: "Feature flag everything user facing... per user and per
// workflow." userId null = organization default for that workflow.
// Partial uniqueness (per-user override vs. org default, one row each) is
// enforced by the two partial unique indexes in 0001_init.sql
// (feature_flag_user_workflow_idx, feature_flag_default_workflow_idx) --
// not expressible in Drizzle's table builder, so not redeclared here. The
// SQL migration is the source of truth for the constraint; this is purely
// for query-building.
export const featureFlag = pgTable("feature_flag", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  workflowKey: text("workflow_key").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  description: text("description").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

// Append-only (spec section 8). UPDATE/DELETE revoked at the DB role level
// in 0002_audit_log_lockdown.sql.
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

// --- Phase 0 mirror tables (spec 3.1, 3.3) -----------------------------

export const client = pgTable("client", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tier: text("tier"),
  ownerUserId: uuid("owner_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const job = pgTable(
  "job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().references(() => client.id),
    title: text("title").notNull(),
    status: text("status").notNull().default("open"),
    targetCompRange: jsonb("target_comp_range"),
    exclusivity: boolean("exclusivity").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientIdx: index("job_client_idx").on(table.clientId),
  }),
);

// Mirror of Crelate. crelate_id is the dedupe key the pull adapter upserts
// on -- see spec 3.1 verbatim.
export const candidate = pgTable("candidate", {
  id: uuid("id").primaryKey().defaultRandom(),
  crelateId: text("crelate_id").notNull().unique(),
  name: text("name").notNull(),
  currentEmployer: text("current_employer"),
  currentTitle: text("current_title"),
  compData: jsonb("comp_data"),
  source: text("source"),
  doNotContact: boolean("do_not_contact").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const engagementStatusEnum = pgEnum("engagement_status", ["active", "on_hold", "closed"]);
export const engagementHealthEnum = pgEnum("engagement_health", [
  "on_track",
  "at_risk",
  "unknown",
]);

export const engagement = pgTable(
  "engagement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id").notNull().references(() => candidate.id),
    jobId: uuid("job_id").notNull().references(() => job.id),
    // Free text until Phase 2's declarative stage config (spec 4.1) exists
    // to validate against -- see 0003_phase0_mirror.sql.
    currentStage: text("current_stage"),
    stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    sourcerUserId: uuid("sourcer_user_id").references(() => users.id),
    status: engagementStatusEnum("status").notNull().default("active"),
    nextActionDueAt: timestamp("next_action_due_at", { withTimezone: true }),
    health: engagementHealthEnum("health").notNull().default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    candidateJobIdx: uniqueIndex("engagement_candidate_id_job_id_key").on(
      table.candidateId,
      table.jobId,
    ),
    jobIdx: index("engagement_job_idx").on(table.jobId),
    ownerIdx: index("engagement_owner_idx").on(table.ownerUserId),
  }),
);

// fee_amount/fee_calc_snapshot are nullable on purpose -- a placement with
// no fee is a Phase 0 reconciliation finding, not something this phase
// computes. See 0003_phase0_mirror.sql.
export const placement = pgTable("placement", {
  id: uuid("id").primaryKey().defaultRandom(),
  engagementId: uuid("engagement_id").notNull().unique().references(() => engagement.id),
  startDate: date("start_date"),
  guaranteedThrough: date("guaranteed_through"),
  acceptedComp: jsonb("accepted_comp"),
  feeAmount: numeric("fee_amount", { precision: 12, scale: 2 }),
  feeCalcSnapshot: jsonb("fee_calc_snapshot"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// placementId is Phase 0's own best-effort link, always null until Phase 1's
// fee entity replaces this column -- see 0003_phase0_mirror.sql.
export const invoice = pgTable(
  "invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quickbooksId: text("quickbooks_id").notNull().unique(),
    placementId: uuid("placement_id").references(() => placement.id),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    placementIdx: index("invoice_placement_idx").on(table.placementId),
  }),
);

export const payment = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quickbooksId: text("quickbooks_id").notNull().unique(),
    invoiceId: uuid("invoice_id").references(() => invoice.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    invoiceIdx: index("payment_invoice_idx").on(table.invoiceId),
  }),
);

// The spine (spec 3.2): every inbound signal becomes a row here first.
// Append-only, enforced at the DB role level in 0003_phase0_mirror.sql.
export const event = pgTable(
  "event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    source: text("source").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    externalId: text("external_id").unique(),
  },
  (table) => ({
    entityIdx: index("event_entity_idx").on(table.entityType, table.entityId),
    sourceIdx: index("event_source_idx").on(table.source, table.type),
  }),
);

// Generic provenance/idempotency table (spec 3.2, section 5's "every
// outbound write checks sync_record.last_hash to avoid write loops").
export const syncRecord = pgTable(
  "sync_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    system: text("system").notNull(),
    externalId: text("external_id").notNull(),
    internalEntity: text("internal_entity").notNull(),
    internalId: text("internal_id").notNull(),
    lastPulledAt: timestamp("last_pulled_at", { withTimezone: true }),
    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
    lastHash: text("last_hash"),
    driftDetectedAt: timestamp("drift_detected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    systemExternalIdx: uniqueIndex("sync_record_system_external_id_internal_entity_key").on(
      table.system,
      table.externalId,
      table.internalEntity,
    ),
    internalIdx: index("sync_record_internal_idx").on(table.internalEntity, table.internalId),
  }),
);
