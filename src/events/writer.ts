// Event spine (spec 3.3): "Every inbound signal... becomes an event row
// before anything else happens. Missing events cannot be invented later."
// Append-only at the database level (migrations/0004 REVOKEs UPDATE/DELETE
// plus a trigger) -- this module is the one writer, not the enforcement.
import { eq } from "drizzle-orm";
import { db, type DbTx } from "@/db/client";
import { event } from "@/db/schema";

export type WriteEventInput = {
  type: string;
  source: "narrow_import" | "manual_ui" | "email_ingest" | "calendar_sync" | "system";
  entityType: string;
  entityId: string;
  payload: unknown;
  occurredAt: Date;
  // Idempotency key (spec 3.3: "external_id UNIQUE for idempotency"). An
  // import or a retried webhook delivery passes the same externalId and
  // gets a no-op on the second call, not a duplicate event.
  externalId?: string;
};

export async function writeEvent(txOrDb: DbTx | typeof db, input: WriteEventInput): Promise<string | null> {
  // Pre-check rather than ON CONFLICT: event_external_id_unique_idx is a
  // partial unique index (WHERE external_id IS NOT NULL, since most events
  // won't carry one), and expressing that arbiter correctly through
  // drizzle's onConflictDoNothing target option couldn't be verified against
  // a live driver in this sandbox (see README, "no npm registry access") --
  // a plain SELECT-then-INSERT is slower under real concurrency but
  // unambiguous, and event writes are not the hot path a race would matter
  // on the way person_merge_candidate's ordered-pair insert is.
  if (input.externalId) {
    const [existing] = await txOrDb.select({ id: event.id }).from(event).where(eq(event.externalId, input.externalId)).limit(1);
    if (existing) return null;
  }

  const [row] = await txOrDb
    .insert(event)
    .values({
      type: input.type,
      source: input.source,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: input.payload as object,
      occurredAt: input.occurredAt,
      externalId: input.externalId,
    })
    .returning({ id: event.id });

  return row?.id ?? null;
}
