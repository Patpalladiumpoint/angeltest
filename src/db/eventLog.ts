import { db } from "./client";
import { event } from "./schema";

export interface RecordEventInput {
  type: string;
  source: string;
  entityType?: string;
  entityId?: string;
  payload: unknown;
  occurredAt?: Date;
  /** Idempotency key (spec 5). Omit only for events with no natural one. */
  externalId?: string;
}

// Spec 3.2: "The event table is the spine... This is what makes the system
// self correcting." Every inbound signal, including an adapter's own
// failures, becomes a row here first.
export async function recordEvent(input: RecordEventInput): Promise<void> {
  const values = {
    type: input.type,
    source: input.source,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: input.payload,
    occurredAt: input.occurredAt ?? new Date(),
    externalId: input.externalId,
  };

  if (input.externalId) {
    // Idempotency (spec 5): "Duplicate ingestion must be a no op."
    await db.insert(event).values(values).onConflictDoNothing({ target: event.externalId });
  } else {
    await db.insert(event).values(values);
  }
}
