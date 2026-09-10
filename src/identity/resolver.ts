// Identity resolution (spec 3.2): three tiers, in order.
//   1. Deterministic match on any normalized person_identifier -- email and
//      LinkedIn URL are near-certain. Auto-merge. Enforced by
//      UNIQUE(type, normalized_value) on person_identifier, not a query
//      this module has to get right every time: findByIdentifier() below
//      is really just "does this identifier already point at a person."
//   2. Strong fuzzy match: pg_trgm name similarity plus matching current
//      employer. Surfaced in the merge review queue. Never auto-merged.
//   3. Weak signals never merge -- below the strong threshold, nothing is
//      surfaced at all.
import { and, eq, sql as rawSql } from "drizzle-orm";
import { db, type Actor, withActor } from "@/db/client";
import { person, personIdentifier, personMergeCandidate } from "@/db/schema";
import { normalizeIdentifier } from "./normalize";

// Strong-match floor for the fuzzy tier. Measured directly against
// pg_trgm's similarity() on real name pairs (see the migration/dataquality
// verification notes in README): "katherine miller"/"kathy miller"
// (same-person nickname case) scores 0.579; "jane doe"/"john doe" and
// "jane doe"/"jane smith" (different people sharing one name token) score
// 0.33-0.38. 0.55 sits between them -- catches the nickname/typo case,
// excludes same-token-different-person noise. Combined with the matching-
// employer-token requirement, not used alone. Not yet calibrated against a
// false-merge audit (spec kill criterion 13: ">2% false merges" -- though
// that criterion is about auto-merges; this tier never auto-merges, it only
// decides what reaches a human).
export const STRONG_FUZZY_MATCH_THRESHOLD = 0.55;

export type IdentifierInput = {
  type: "email" | "phone" | "linkedin_url" | "legacy_id";
  value: string;
};

// Tier 1. Returns the person_id already holding this identifier, if any.
// Callers use this before inserting a new person_identifier row: a hit
// means "this is the same person," full stop -- not a candidate, a match.
export async function findByIdentifier(input: IdentifierInput): Promise<string | null> {
  const normalizedValue = normalizeIdentifier(input.type, input.value);
  const [row] = await db
    .select({ personId: personIdentifier.personId })
    .from(personIdentifier)
    .where(and(eq(personIdentifier.type, input.type), eq(personIdentifier.normalizedValue, normalizedValue)))
    .limit(1);
  return row?.personId ?? null;
}

export type FuzzyMatchCandidate = {
  personId: string;
  primaryName: string;
  similarity: number;
};

// Tier 2's candidate generation. Narrows on the dedup_fingerprint's
// employer token first (cheap equality), then runs pg_trgm similarity()
// against the strong-match floor. Does not write anything -- see
// enqueueMergeCandidates() for persisting hits to the review queue.
export async function findFuzzyMatchCandidates(
  organizationId: string,
  targetPersonId: string,
): Promise<FuzzyMatchCandidate[]> {
  const [target] = await db.select().from(person).where(eq(person.id, targetPersonId)).limit(1);
  if (!target || !target.dedupFingerprint) return [];

  const employerToken = target.dedupFingerprint.split("|")[1] ?? "";
  if (!employerToken) return [];

  const rows = await db.execute<{ person_id: string; primary_name: string; sim: number }>(rawSql`
    SELECT id AS person_id, primary_name, similarity(primary_name, ${target.primaryName}) AS sim
    FROM person
    WHERE organization_id = ${organizationId}
      AND id <> ${targetPersonId}
      AND split_part(dedup_fingerprint, '|', 2) = ${employerToken}
      AND similarity(primary_name, ${target.primaryName}) >= ${STRONG_FUZZY_MATCH_THRESHOLD}
    ORDER BY sim DESC
  `);

  return rows.map((r) => ({ personId: r.person_id, primaryName: r.primary_name, similarity: Number(r.sim) }));
}

// Runs findFuzzyMatchCandidates for one person and inserts any new hits
// into person_merge_candidate (status 'pending'). Idempotent: the queue's
// UNIQUE(person_a_id, person_b_id) with the ordered-pair CHECK means a
// re-run against the same pair is a no-op, not a duplicate row -- see
// migrations/0008. Call this from the narrow importer after each person
// insert, and from a periodic sweep once one exists.
export async function enqueueMergeCandidates(organizationId: string, targetPersonId: string): Promise<number> {
  const candidates = await findFuzzyMatchCandidates(organizationId, targetPersonId);
  let inserted = 0;

  for (const candidate of candidates) {
    const [a, b] = [targetPersonId, candidate.personId].sort();
    const result = await db
      .insert(personMergeCandidate)
      .values({
        personAId: a!,
        personBId: b!,
        similarity: candidate.similarity,
        matchedOn: "name_trgm+current_employer",
      })
      .onConflictDoNothing({ target: [personMergeCandidate.personAId, personMergeCandidate.personBId] })
      .returning({ id: personMergeCandidate.id });
    if (result.length > 0) inserted += 1;
  }

  return inserted;
}

export type PendingMergeCandidate = {
  id: string;
  personAId: string;
  personAName: string;
  personBId: string;
  personBName: string;
  similarity: number;
  matchedOn: string;
  createdAt: Date;
};

// Backs the merge review queue UI (Phase 1 bullet: "worked down to zero
// strong-match candidates").
export async function listPendingMergeCandidates(): Promise<PendingMergeCandidate[]> {
  const rows = await db.execute<{
    id: string;
    person_a_id: string;
    person_a_name: string;
    person_b_id: string;
    person_b_name: string;
    similarity: number;
    matched_on: string;
    created_at: Date;
  }>(rawSql`
    SELECT c.id, c.person_a_id, a.primary_name AS person_a_name, c.person_b_id, b.primary_name AS person_b_name,
           c.similarity, c.matched_on, c.created_at
    FROM person_merge_candidate c
    JOIN person a ON a.id = c.person_a_id
    JOIN person b ON b.id = c.person_b_id
    WHERE c.status = 'pending'
    ORDER BY c.similarity DESC, c.created_at ASC
  `);

  return rows.map((r) => ({
    id: r.id,
    personAId: r.person_a_id,
    personAName: r.person_a_name,
    personBId: r.person_b_id,
    personBName: r.person_b_name,
    similarity: Number(r.similarity),
    matchedOn: r.matched_on,
    createdAt: r.created_at,
  }));
}

export async function rejectMergeCandidate(candidateId: string, actor: Actor): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx
      .update(personMergeCandidate)
      .set({ status: "rejected", reviewedBy: actor.userId, reviewedAt: new Date() })
      .where(eq(personMergeCandidate.id, candidateId));
  });
}
