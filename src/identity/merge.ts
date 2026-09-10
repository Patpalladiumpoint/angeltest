// Merge / reverse (spec 3.2, 3.3, section 0's own worked example: reversible
// merges, no hard deletes, ever). The absorbed person's row, identifiers,
// and employment are never deleted -- merging re-points what can be moved
// without conflict and records exactly what moved in person_merge.snapshot
// so reversePersonMerge() can undo precisely that, and nothing else.
import { eq, and, isNull } from "drizzle-orm";
import { withActor, type Actor, type DbTx } from "@/db/client";
import { person, personIdentifier, personEmployment, engagement, personMerge, personMergeCandidate } from "@/db/schema";
import { writeAuditLog } from "@/audit/log";
import { writeEvent } from "@/events/writer";

type MoveRecord = {
  movedIdentifierIds: string[];
  skippedIdentifierIds: string[]; // conflicted with an identifier the survivor already had
  movedEmploymentIds: string[];
  movedEngagementIds: string[];
  skippedEngagementIds: string[]; // survivor already had an engagement for the same job
};

export type MergeResult = {
  personMergeId: string;
  moves: MoveRecord;
};

export async function mergePerson(
  survivingPersonId: string,
  absorbedPersonId: string,
  actor: Actor,
  candidateId?: string,
): Promise<MergeResult> {
  if (survivingPersonId === absorbedPersonId) {
    throw new Error("cannot merge a person into themselves");
  }

  return withActor(actor, async (tx) => {
    const [survivor] = await tx.select().from(person).where(eq(person.id, survivingPersonId)).limit(1);
    const [absorbed] = await tx.select().from(person).where(eq(person.id, absorbedPersonId)).limit(1);
    if (!survivor || !absorbed) throw new Error("both persons must exist to merge");

    const absorbedIdentifiers = await tx
      .select()
      .from(personIdentifier)
      .where(eq(personIdentifier.personId, absorbedPersonId));
    // Real bug, caught live against Postgres: a bare .select() here
    // requests every column, including comp, which has table-level
    // SELECT revoked from palladium_app (migrations/0007) -- this would
    // fail with "permission denied" the moment a merge candidate with
    // any employment history ran against a real database. Excluding comp
    // fixes that *and* closes a latent privacy gap: the excluded columns
    // are all that's needed to move rows and to describe them in
    // absorbedSnapshot (below) -- embedding raw comp in that jsonb column
    // would have been a second, unaudited copy of exactly the data
    // get_person_employment_comp() exists to gate and log every read of.
    // The comp figure itself is never lost -- it stays on the
    // person_employment row, which is only re-pointed to the survivor's
    // person_id, never deleted or rewritten.
    const absorbedEmployment = await tx
      .select({
        id: personEmployment.id,
        personId: personEmployment.personId,
        employerName: personEmployment.employerName,
        brokerageId: personEmployment.brokerageId,
        title: personEmployment.title,
        isCurrent: personEmployment.isCurrent,
        bookOfBusiness: personEmployment.bookOfBusiness,
        source: personEmployment.source,
        createdAt: personEmployment.createdAt,
      })
      .from(personEmployment)
      .where(eq(personEmployment.personId, absorbedPersonId));
    const absorbedEngagements = await tx.select().from(engagement).where(eq(engagement.personId, absorbedPersonId));

    const moves: MoveRecord = {
      movedIdentifierIds: [],
      skippedIdentifierIds: [],
      movedEmploymentIds: [],
      movedEngagementIds: [],
      skippedEngagementIds: [],
    };

    // Identifiers: move unless the survivor already holds the identical
    // (type, normalized_value) -- that's the deterministic-match tier's own
    // constraint firing, not an error to suppress silently, but also not a
    // reason to abort the whole merge. Pre-check rather than try/catch so
    // one conflict doesn't abort the surrounding transaction.
    for (const identifier of absorbedIdentifiers) {
      const conflict = await tx
        .select({ id: personIdentifier.id })
        .from(personIdentifier)
        .where(
          and(
            eq(personIdentifier.personId, survivingPersonId),
            eq(personIdentifier.type, identifier.type),
            eq(personIdentifier.normalizedValue, identifier.normalizedValue),
          ),
        )
        .limit(1);
      if (conflict.length > 0) {
        moves.skippedIdentifierIds.push(identifier.id);
        continue;
      }
      await tx.update(personIdentifier).set({ personId: survivingPersonId }).where(eq(personIdentifier.id, identifier.id));
      moves.movedIdentifierIds.push(identifier.id);
    }

    // Employment: no uniqueness constraint blocks this, always moves.
    for (const employment of absorbedEmployment) {
      await tx.update(personEmployment).set({ personId: survivingPersonId }).where(eq(personEmployment.id, employment.id));
      moves.movedEmploymentIds.push(employment.id);
    }

    // Engagements: UNIQUE(person_id, job_id). If the survivor already has an
    // engagement for the same job, that's a real process collision needing
    // a human, not something to silently resolve -- leave it attached to
    // the absorbed person (whose row still exists) and surface it as a
    // skipped engagement so the merge action's caller can flag it.
    for (const eng of absorbedEngagements) {
      const conflict = await tx
        .select({ id: engagement.id })
        .from(engagement)
        .where(and(eq(engagement.personId, survivingPersonId), eq(engagement.jobId, eng.jobId)))
        .limit(1);
      if (conflict.length > 0) {
        moves.skippedEngagementIds.push(eng.id);
        continue;
      }
      await tx.update(engagement).set({ personId: survivingPersonId }).where(eq(engagement.id, eng.id));
      moves.movedEngagementIds.push(eng.id);
    }

    const [mergeRow] = await tx
      .insert(personMerge)
      .values({
        survivingPersonId,
        absorbedPersonId,
        absorbedSnapshot: { person: absorbed, identifiers: absorbedIdentifiers, employment: absorbedEmployment, moves },
        mergedBy: actor.userId,
      })
      .returning({ id: personMerge.id });

    if (candidateId) {
      await tx
        .update(personMergeCandidate)
        .set({ status: "merged", reviewedBy: actor.userId, reviewedAt: new Date() })
        .where(eq(personMergeCandidate.id, candidateId));
    }

    await writeAuditLog(tx, {
      actorUserId: actor.userId,
      action: "merge_person",
      entityType: "person",
      entityId: survivingPersonId,
      before: { absorbedPersonId },
      after: { moves },
    });

    await writeEvent(tx, {
      type: "person.merged",
      source: "manual_ui",
      entityType: "person",
      entityId: survivingPersonId,
      payload: { absorbedPersonId, moves },
      occurredAt: new Date(),
    });

    return { personMergeId: mergeRow!.id, moves };
  });
}

export async function reversePersonMerge(personMergeId: string, actor: Actor): Promise<void> {
  await withActor(actor, async (tx) => {
    const [mergeRow] = await tx.select().from(personMerge).where(eq(personMerge.id, personMergeId)).limit(1);
    if (!mergeRow) throw new Error("merge record not found");
    if (mergeRow.reversedAt) throw new Error("merge already reversed");

    const snapshot = mergeRow.absorbedSnapshot as { moves: MoveRecord };
    const { movedIdentifierIds, movedEmploymentIds, movedEngagementIds } = snapshot.moves;

    for (const id of movedIdentifierIds) {
      await tx.update(personIdentifier).set({ personId: mergeRow.absorbedPersonId }).where(eq(personIdentifier.id, id));
    }
    for (const id of movedEmploymentIds) {
      await tx.update(personEmployment).set({ personId: mergeRow.absorbedPersonId }).where(eq(personEmployment.id, id));
    }
    for (const id of movedEngagementIds) {
      await tx.update(engagement).set({ personId: mergeRow.absorbedPersonId }).where(eq(engagement.id, id));
    }

    await tx
      .update(personMerge)
      .set({ reversedAt: new Date(), reversedBy: actor.userId })
      .where(eq(personMerge.id, personMergeId));

    await writeAuditLog(tx, {
      actorUserId: actor.userId,
      action: "reverse_person_merge",
      entityType: "person",
      entityId: mergeRow.survivingPersonId,
      before: null,
      after: { restoredTo: mergeRow.absorbedPersonId },
    });

    await writeEvent(tx, {
      type: "person.merge_reversed",
      source: "manual_ui",
      entityType: "person",
      entityId: mergeRow.survivingPersonId,
      payload: { absorbedPersonId: mergeRow.absorbedPersonId },
      occurredAt: new Date(),
    });
  });
}

// True if this person is currently the losing side of an unreversed merge --
// callers (record views, search) use this to redirect to the survivor
// rather than showing a dead-end record. No denormalized column on person
// itself; derived from person_merge so there's nothing to keep in sync.
export async function getMergeRedirect(tx: DbTx, personId: string): Promise<string | null> {
  const [row] = await tx
    .select({ survivingPersonId: personMerge.survivingPersonId })
    .from(personMerge)
    .where(and(eq(personMerge.absorbedPersonId, personId), isNull(personMerge.reversedAt)))
    .limit(1);
  return row?.survivingPersonId ?? null;
}
