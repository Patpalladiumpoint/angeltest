import { db } from "@/db/client";
import { candidates, firms, candidateClaims, contactLedger, users } from "@/db/schema";
import { desc, eq, and } from "drizzle-orm";

export interface CandidateListRow {
  id: string;
  fullName: string;
  currentTitle: string | null;
  firmName: string | null;
  doNotContact: boolean;
  ownerEmail: string | null;
  lastContactAt: Date | null;
}

// Everyone sees every candidate (spec section 5: "Opacity is what created
// the collision problem, so transparency is the feature") -- there is no
// per-recruiter filtering here, deliberately.
export async function listCandidates(): Promise<CandidateListRow[]> {
  const rows = await db
    .select({
      id: candidates.id,
      fullName: candidates.fullName,
      currentTitle: candidates.currentTitle,
      firmName: firms.canonicalName,
      currentFirmRaw: candidates.currentFirmRaw,
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
    doNotContact: row.doNotContact,
    ownerEmail: row.ownerEmail,
    lastContactAt: lastContactByCandidate.get(row.id) ?? null,
  }));
}

export async function listFirms() {
  return db.select().from(firms).orderBy(firms.canonicalName);
}

export async function getCandidateDetail(candidateId: string) {
  const [candidate] = await db
    .select({
      id: candidates.id,
      fullName: candidates.fullName,
      currentTitle: candidates.currentTitle,
      currentFirmRaw: candidates.currentFirmRaw,
      firmName: firms.canonicalName,
      linkedinUrl: candidates.linkedinUrl,
      doNotContact: candidates.doNotContact,
    })
    .from(candidates)
    .leftJoin(firms, eq(candidates.resolvedFirmId, firms.id))
    .where(eq(candidates.id, candidateId));

  if (!candidate) return null;

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

  const contactHistory = await db
    .select({
      id: contactLedger.id,
      channel: contactLedger.channel,
      outcome: contactLedger.outcome,
      occurredAt: contactLedger.occurredAt,
      userEmail: users.email,
    })
    .from(contactLedger)
    .innerJoin(users, eq(contactLedger.userId, users.id))
    .where(eq(contactLedger.candidateId, candidateId))
    .orderBy(desc(contactLedger.occurredAt));

  return { candidate, activeClaim: activeClaim ?? null, contactHistory };
}
