// Audit log writer (spec 3.3, 11: "audit log on every mutation, plus every
// read of compensation data"). Append-only at the database level
// (migrations/0004) -- this is the one writer, not the enforcement. The
// compensation-read half of "every read" is handled inside the
// get_person_employment_comp() SQL function (migrations/0007), not here,
// since that read has to be audited even if it's reached through a path
// that never touches this module.
import type { DbTx } from "@/db/client";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";

export type WriteAuditLogInput = {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
};

export async function writeAuditLog(txOrDb: DbTx | typeof db, input: WriteAuditLogInput): Promise<void> {
  await txOrDb.insert(auditLog).values({
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before as object | null,
    after: input.after as object | null,
  });
}
