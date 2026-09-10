import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";

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
