import { db } from "@/db/client";
import {
  candidates,
  firms,
  candidateClaims,
  contactLedger,
  activities,
  documents,
  users,
} from "@/db/schema";
import { desc, eq, and, isNull, isNotNull, ne, sql } from "drizzle-orm";

export interface CandidateListRow {
  id: string;
  fullName: string;
  currentTitle: string | null;
  firmName: string | null;
  specialty: string | null;
  location: string | null;
  doNotContact: boolean;
  ownerEmail: string | null;
  lastContactAt: Date | null;
}

export interface CandidateListFilters {
  query?: string;
  specialty?: string;
  location?: string;
}

// Everyone sees every candidate (spec section 5: "Opacity is what created
// the collision problem, so transparency is the feature") -- there is no
// per-recruiter filtering here, deliberately. Merged-away records
// (merged_into_id set) are excluded -- they're reachable from the winner's
// detail page, not the main list (spec 3.6: soft and reversible, not
// invisible).
export async function listCandidates(filters: CandidateListFilters = {}): Promise<CandidateListRow[]> {
  const conditions = [isNull(candidates.mergedIntoId)];

  if (filters.query?.trim()) {
    // search_vector isn't modeled in the Drizzle schema (see schema.ts) --
    // it's a DB-generated column the app never writes, only queries via
    // raw SQL like this.
    conditions.push(sql`${candidates}.search_vector @@ websearch_to_tsquery('english', ${filters.query})`);
  }
  if (filters.specialty) {
    conditions.push(eq(candidates.specialty, filters.specialty));
  }
  if (filters.location) {
    conditions.push(eq(candidates.location, filters.location));
  }

  const rows = await db
    .select({
      id: candidates.id,
      fullName: candidates.fullName,
      currentTitle: candidates.currentTitle,
      firmName: firms.canonicalName,
      currentFirmRaw: candidates.currentFirmRaw,
      specialty: candidates.specialty,
      location: candidates.location,
      doNotContact: candidates.doNotContact,
      ownerEmail: users.email,
    })
    .from(candidates)
    .leftJoin(firms, eq(candidates.resolvedFirmId, firms.id))
    .leftJoin(
      candidateClaims,
      and(eq(candidateClaims.candidateId, candidates.id), eq(candidateClaims.status, "active")),
    )
    .leftJoin(users, eq(candidateClaims.ownerUserId, users.id))
    .where(and(...conditions))
    .orderBy(desc(candidates.createdAt));

  const lastContacts = await db
    .select({ candidateId: contactLedger.candidateId, occurredAt: contactLedger.occurredAt })
    .from(contactLedger)
    .orderBy(desc(contactLedger.occurredAt));

  const lastContactByCandidate = new Map<string, Date>();
  for (const row of lastContacts) {
    if (!lastContactByCandidate.has(row.candidateId)) {
      lastContactByCandidate.set(row.candidateId, row.occurredAt);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    currentTitle: row.currentTitle,
    firmName: row.firmName ?? row.currentFirmRaw,
    specialty: row.specialty,
    location: row.location,
    doNotContact: row.doNotContact,
    ownerEmail: row.ownerEmail,
    lastContactAt: lastContactByCandidate.get(row.id) ?? null,
  }));
}

// Distinct specialty/location values in use, for the faceted-search filter
// dropdowns. Deliberately not a fixed enum (spec doesn't define one) --
// whatever values recruiters have actually entered.
export async function listCandidateFacets(): Promise<{ specialties: string[]; locations: string[] }> {
  const [specialtyRows, locationRows] = await Promise.all([
    db
      .selectDistinct({ specialty: candidates.specialty })
      .from(candidates)
      .where(and(isNull(candidates.mergedIntoId), isNotNull(candidates.specialty))),
    db
      .selectDistinct({ location: candidates.location })
      .from(candidates)
      .where(and(isNull(candidates.mergedIntoId), isNotNull(candidates.location))),
  ]);

  return {
    specialties: specialtyRows.map((r) => r.specialty!).sort(),
    locations: locationRows.map((r) => r.location!).sort(),
  };
}

export async function listFirms() {
  return db.select().from(firms).orderBy(firms.canonicalName);
}

export interface TimelineEntry {
  id: string;
  occurredAt: Date;
  activityType: string;
  direction: string | null;
  subject: string | null;
  body: string | null;
  userEmail: string | null;
  sourceCandidateId: string; // which merged-in record this came from, if any
}

export async function getCandidateDetail(candidateId: string) {
  const [candidate] = await db
    .select({
      id: candidates.id,
      fullName: candidates.fullName,
      preferredName: candidates.preferredName,
      currentTitle: candidates.currentTitle,
      currentFirmRaw: candidates.currentFirmRaw,
      resolvedFirmId: candidates.resolvedFirmId,
      firmName: firms.canonicalName,
      specialty: candidates.specialty,
      location: candidates.location,
      seniority: candidates.seniority,
      linkedinUrl: candidates.linkedinUrl,
      source: candidates.source,
      summary: candidates.summary,
      doNotContact: candidates.doNotContact,
      dncReason: candidates.dncReason,
      firmResolutionMethod: candidates.firmResolutionMethod,
      firmResolutionConfidence: candidates.firmResolutionConfidence,
      mergedIntoId: candidates.mergedIntoId,
    })
    .from(candidates)
    .leftJoin(firms, eq(candidates.resolvedFirmId, firms.id))
    .where(eq(candidates.id, candidateId));

  if (!candidate) return null;

  // A merged-away record shows a redirect notice, not full detail -- the
  // data is retained (spec 3.6: soft, reversible for 90 days) but the
  // record is no longer the live one to work from.
  if (candidate.mergedIntoId) {
    const [winner] = await db
      .select({ id: candidates.id, fullName: candidates.fullName })
      .from(candidates)
      .where(eq(candidates.id, candidate.mergedIntoId));
    return { candidate, mergedInto: winner ?? null, activeClaim: null, timeline: [], documents: [] };
  }

  // Candidates previously merged INTO this one -- their activity history
  // folds into this timeline (spec 3.6 implies a merge shouldn't lose
  // history) without physically moving any rows.
  const mergedInIds = (
    await db.select({ id: candidates.id }).from(candidates).where(eq(candidates.mergedIntoId, candidateId))
  ).map((r) => r.id);
  const allIds = [candidateId, ...mergedInIds];

  const [activeClaim] = await db
    .select({
      ownerUserId: candidateClaims.ownerUserId,
      ownerEmail: users.email,
      ownerName: users.name,
      claimedAt: candidateClaims.claimedAt,
      claimBasis: candidateClaims.claimBasis,
    })
    .from(candidateClaims)
    .innerJoin(users, eq(candidateClaims.ownerUserId, users.id))
    .where(and(eq(candidateClaims.candidateId, candidateId), eq(candidateClaims.status, "active")));

  const timeline: TimelineEntry[] = [];
  for (const id of allIds) {
    const rows = await db
      .select({
        id: activities.id,
        occurredAt: activities.occurredAt,
        activityType: activities.activityType,
        direction: activities.direction,
        subject: activities.subject,
        body: activities.body,
        userEmail: users.email,
      })
      .from(activities)
      .leftJoin(users, eq(activities.userId, users.id))
      .where(eq(activities.candidateId, id));
    timeline.push(...rows.map((r) => ({ ...r, sourceCandidateId: id })));
  }
  timeline.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  const candidateDocuments = await db
    .select()
    .from(documents)
    .where(eq(documents.candidateId, candidateId))
    .orderBy(desc(documents.createdAt));

  return { candidate, mergedInto: null, activeClaim: activeClaim ?? null, timeline, documents: candidateDocuments };
}

// Duplicate-merge candidates: other live candidates with the same full
// name, for a lightweight "possible duplicate" picker on the merge form.
// Not the spec's real fuzzy-name-plus-LinkedIn dedupe (that's Phase 2
// migration-scale work) -- just enough to make merge usable by hand today.
export async function findPossibleDuplicates(candidateId: string, fullName: string) {
  return db
    .select({ id: candidates.id, fullName: candidates.fullName, currentTitle: candidates.currentTitle })
    .from(candidates)
    .where(
      and(ne(candidates.id, candidateId), isNull(candidates.mergedIntoId), eq(candidates.fullName, fullName)),
    );
}
