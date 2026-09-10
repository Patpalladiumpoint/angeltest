"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import {
  candidates,
  candidateClaims,
  contactLedger,
  activities,
  auditLog,
  users,
  GLOBAL_CONTACT_COOLDOWN_DAYS,
} from "@/db/schema";
import { requireUser } from "@/auth/requireAdmin";
import { resolveFirm, requiresManualConfirmation } from "@/firms/resolver";
import type { ActionResult } from "@/lib/actions";

export type { ActionResult };

interface CandidateFieldInput {
  fullName: string;
  preferredName: string | null;
  currentTitle: string | null;
  currentFirmRaw: string | null;
  linkedinUrl: string | null;
  specialty: string | null;
  location: string | null;
  seniority: string | null;
  summary: string | null;
  manualFirmId: string | null;
}

function readCandidateFields(formData: FormData): CandidateFieldInput {
  return {
    fullName: String(formData.get("fullName") ?? "").trim(),
    preferredName: optionalString(formData.get("preferredName")),
    currentTitle: optionalString(formData.get("currentTitle")),
    currentFirmRaw: optionalString(formData.get("currentFirmRaw")),
    linkedinUrl: optionalString(formData.get("linkedinUrl")),
    specialty: optionalString(formData.get("specialty")),
    location: optionalString(formData.get("location")),
    seniority: optionalString(formData.get("seniority")),
    summary: optionalString(formData.get("summary")),
    manualFirmId: optionalString(formData.get("resolvedFirmId")),
  };
}

// Spec 8.1 step 1 lives downstream of this (the actual eligibility hard
// stop is Phase 8) -- what this does is exactly Phase 3's job of wiring
// Phase 1's resolver into candidate create/edit: a human-picked firm is
// trusted outright ("manual", confidence 1.0); otherwise resolveFirm() runs
// and its result is only auto-applied to resolvedFirmId when it clears the
// spec 8.1 confidence bar. A fuzzy or absent match still records what the
// resolver found, so a reviewer can see there's a candidate firm worth
// confirming instead of the field just silently staying blank.
async function resolveFirmForCandidate(input: {
  currentFirmRaw: string | null;
  manualFirmId: string | null;
}): Promise<{
  resolvedFirmId: string | null;
  firmResolutionMethod: "exact" | "alias" | "fuzzy" | "manual" | null;
  firmResolutionConfidence: number | null;
}> {
  if (input.manualFirmId) {
    return { resolvedFirmId: input.manualFirmId, firmResolutionMethod: "manual", firmResolutionConfidence: 1.0 };
  }
  if (!input.currentFirmRaw) {
    return { resolvedFirmId: null, firmResolutionMethod: null, firmResolutionConfidence: null };
  }

  const resolution = await resolveFirm(input.currentFirmRaw);
  const method = resolution.method === "none" ? null : resolution.method;
  const confidence = resolution.status === "resolved" ? resolution.confidence : null;

  if (requiresManualConfirmation(resolution)) {
    return { resolvedFirmId: null, firmResolutionMethod: method, firmResolutionConfidence: confidence };
  }
  return { resolvedFirmId: resolution.firmId, firmResolutionMethod: method, firmResolutionConfidence: confidence };
}

export async function createCandidateAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const fields = readCandidateFields(formData);
  if (!fields.fullName) return { ok: false, error: "Name is required" };

  const firmResolution = await resolveFirmForCandidate(fields);

  const [candidate] = await db
    .insert(candidates)
    .values({
      fullName: fields.fullName,
      preferredName: fields.preferredName,
      currentTitle: fields.currentTitle,
      currentFirmRaw: fields.currentFirmRaw,
      resolvedFirmId: firmResolution.resolvedFirmId,
      firmResolutionMethod: firmResolution.firmResolutionMethod,
      firmResolutionConfidence: firmResolution.firmResolutionConfidence,
      linkedinUrl: fields.linkedinUrl,
      specialty: fields.specialty,
      location: fields.location,
      seniority: fields.seniority,
      summary: fields.summary,
      createdBy: session.user.id,
    })
    .returning({ id: candidates.id });

  await db.insert(activities).values({
    candidateId: candidate!.id,
    userId: session.user.id,
    activityType: "system",
    subject: "Candidate created",
  });

  await db.insert(auditLog).values({
    actorUserId: session.user.id,
    entityType: "candidate",
    entityId: candidate!.id,
    action: "create",
    after: fields,
  });

  revalidatePath("/candidates");
  return { ok: true };
}

export async function updateCandidateAction(candidateId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const fields = readCandidateFields(formData);
  if (!fields.fullName) return { ok: false, error: "Name is required" };

  const [before] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
  if (!before) return { ok: false, error: "Candidate not found" };
  if (before.mergedIntoId) return { ok: false, error: "This record was merged; edit the surviving record instead" };

  // Re-run the resolver only when the firm string actually changed, or a
  // different manual firm was picked -- otherwise an edit to, say, just the
  // summary would needlessly re-flip an already-confirmed resolution.
  const firmChanged =
    fields.currentFirmRaw !== before.currentFirmRaw || fields.manualFirmId !== null;
  const firmResolution = firmChanged
    ? await resolveFirmForCandidate(fields)
    : {
        resolvedFirmId: before.resolvedFirmId,
        firmResolutionMethod: before.firmResolutionMethod,
        firmResolutionConfidence: before.firmResolutionConfidence,
      };

  await db
    .update(candidates)
    .set({
      fullName: fields.fullName,
      preferredName: fields.preferredName,
      currentTitle: fields.currentTitle,
      currentFirmRaw: fields.currentFirmRaw,
      resolvedFirmId: firmResolution.resolvedFirmId,
      firmResolutionMethod: firmResolution.firmResolutionMethod,
      firmResolutionConfidence: firmResolution.firmResolutionConfidence,
      linkedinUrl: fields.linkedinUrl,
      specialty: fields.specialty,
      location: fields.location,
      seniority: fields.seniority,
      summary: fields.summary,
      updatedAt: new Date(),
    })
    .where(eq(candidates.id, candidateId));

  await db.insert(auditLog).values({
    actorUserId: session.user.id,
    entityType: "candidate",
    entityId: candidateId,
    action: "edit",
    before,
    after: fields,
  });

  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/candidates");
  return { ok: true };
}

// Manual claim (spec 8.2, claim_basis "manual_override" in the full model --
// this MVP only distinguishes first_touch vs. everything-else-is-manual).
// The partial unique index on candidate_claims is what actually prevents
// two recruiters from both winning; this action just surfaces a readable
// error when that happens instead of a raw constraint-violation message.
export async function claimCandidateAction(candidateId: string): Promise<ActionResult> {
  const session = await requireUser();

  try {
    await db.insert(candidateClaims).values({
      candidateId,
      ownerUserId: session.user.id,
      claimBasis: "manual_override",
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;

    const [existing] = await db
      .select({ ownerEmail: users.email, claimedAt: candidateClaims.claimedAt })
      .from(candidateClaims)
      .innerJoin(users, eq(candidateClaims.ownerUserId, users.id))
      .where(and(eq(candidateClaims.candidateId, candidateId), eq(candidateClaims.status, "active")));

    return {
      ok: false,
      error: existing
        ? `Already claimed by ${existing.ownerEmail} on ${existing.claimedAt.toLocaleDateString()}`
        : "Already claimed by another recruiter",
    };
  }

  await db.insert(auditLog).values({
    actorUserId: session.user.id,
    entityType: "candidate_claims",
    entityId: candidateId,
    action: "claim",
  });

  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/candidates");
  return { ok: true };
}

// The collision gate (spec 8.1 step 5 / 8.2 "Global cooldown independent of
// ownership"): nobody -- including the same recruiter on a different search
// -- contacts a candidate within COOLDOWN_DAYS of the last outbound touch by
// ANYONE. This is deliberately checked here, at the moment of logging
// contact, not just at claim time -- state drifts between the two (working
// agreement: "Every gate is checked twice").
export async function logContactAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const candidateId = String(formData.get("candidateId") ?? "");
  const channel = String(formData.get("channel") ?? "") as "call" | "email" | "linkedin" | "note";
  const outcome = optionalString(formData.get("outcome"));

  if (!candidateId || !channel) return { ok: false, error: "Missing candidate or channel" };

  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
  if (!candidate) return { ok: false, error: "Candidate not found" };
  if (candidate.mergedIntoId) return { ok: false, error: "This record was merged; log contact on the surviving record instead" };
  if (candidate.doNotContact) {
    return { ok: false, error: "This candidate is marked do-not-contact" };
  }

  const cooldownCutoff = new Date(Date.now() - GLOBAL_CONTACT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  const [recentContact] = await db
    .select({ userEmail: users.email, occurredAt: contactLedger.occurredAt })
    .from(contactLedger)
    .innerJoin(users, eq(contactLedger.userId, users.id))
    .where(and(eq(contactLedger.candidateId, candidateId), gt(contactLedger.occurredAt, cooldownCutoff)))
    .orderBy(desc(contactLedger.occurredAt))
    .limit(1);

  if (recentContact) {
    await db.insert(auditLog).values({
      actorUserId: session.user.id,
      entityType: "contact_ledger",
      entityId: candidateId,
      action: "collision_blocked",
      reason: `Blocked: ${recentContact.userEmail} contacted this candidate on ${recentContact.occurredAt.toISOString()}, within the ${GLOBAL_CONTACT_COOLDOWN_DAYS}-day cooldown`,
    });

    return {
      ok: false,
      error: `Blocked: ${recentContact.userEmail} already contacted this candidate on ${recentContact.occurredAt.toLocaleDateString()} (within the last ${GLOBAL_CONTACT_COOLDOWN_DAYS} days)`,
    };
  }

  await db.insert(contactLedger).values({ candidateId, userId: session.user.id, channel, outcome });

  // Every logged contact is also a timeline entry (spec 5: activities is
  // "the unified timeline... all on one timeline") -- contact_ledger stays
  // the lean collision-check table, this is the human-readable record of
  // the same event.
  await db.insert(activities).values({
    candidateId,
    userId: session.user.id,
    activityType: channel === "linkedin" ? "linkedin" : channel === "call" ? "call" : channel === "email" ? "email" : "note",
    direction: "outbound",
    subject: `Logged ${channel} contact`,
    body: outcome,
  });

  // First-touch ownership default (spec 8.2): claim it for the toucher if
  // nobody has an active claim yet. Racing this against a concurrent claim
  // is safe -- the unique index below is the real guard -- so a loss here
  // just means someone else's claim (or contact) won the race first.
  try {
    await db.insert(candidateClaims).values({
      candidateId,
      ownerUserId: session.user.id,
      claimBasis: "first_touch",
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Someone already holds an active claim; the contact is still logged.
  }

  await db.insert(auditLog).values({
    actorUserId: session.user.id,
    entityType: "contact_ledger",
    entityId: candidateId,
    action: "contact_logged",
    after: { channel, outcome },
  });

  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/candidates");
  return { ok: true };
}

// Manual note/call/meeting log that ISN'T an outbound touch -- e.g. writing
// up a call the candidate initiated, or a meeting note. Deliberately
// bypasses the collision gate and does not write to contact_ledger: the
// gate exists to stop unsolicited outbound, not to stop recruiters from
// recording what already happened.
export async function logActivityAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const candidateId = String(formData.get("candidateId") ?? "");
  const activityType = String(formData.get("activityType") ?? "") as "call" | "note" | "meeting";
  const subject = optionalString(formData.get("subject"));
  const body = optionalString(formData.get("body"));

  if (!candidateId || !activityType) return { ok: false, error: "Missing candidate or activity type" };

  await db.insert(activities).values({
    candidateId,
    userId: session.user.id,
    activityType,
    direction: "inbound",
    subject: subject ?? `Logged a ${activityType}`,
    body,
  });

  revalidatePath(`/candidates/${candidateId}`);
  return { ok: true };
}

// Soft merge (spec 3.6: "Merges and deletions are soft and reversible for
// 90 days... Assume someone will fat-finger a merge of two senior
// candidates and need it undone"). Nothing is deleted or moved: the loser
// keeps its own row and activity history, and getCandidateDetail() folds
// that history into the winner's timeline by querying both, not by
// physically relocating rows -- unmerge is then just clearing one column.
export async function mergeCandidatesAction(
  loserId: string,
  winnerId: string,
  reason: string,
): Promise<ActionResult> {
  const session = await requireUser();
  if (!reason.trim()) return { ok: false, error: "A reason is required to merge two candidates" };
  if (loserId === winnerId) return { ok: false, error: "Cannot merge a candidate into itself" };

  const [loser] = await db.select().from(candidates).where(eq(candidates.id, loserId));
  const [winner] = await db.select().from(candidates).where(eq(candidates.id, winnerId));
  if (!loser || !winner) return { ok: false, error: "Candidate not found" };
  if (loser.mergedIntoId || winner.mergedIntoId) {
    return { ok: false, error: "One of these candidates has already been merged" };
  }

  const [loserClaim] = await db
    .select()
    .from(candidateClaims)
    .where(and(eq(candidateClaims.candidateId, loserId), eq(candidateClaims.status, "active")));
  const [winnerClaim] = await db
    .select()
    .from(candidateClaims)
    .where(and(eq(candidateClaims.candidateId, winnerId), eq(candidateClaims.status, "active")));

  // A claim collision at merge time -- exactly the scenario spec 3.6 warns
  // about -- is resolved by keeping the winner's claim and releasing the
  // loser's, logged explicitly rather than silently dropped. If only the
  // loser had a claim, it carries over so ownership isn't lost in the merge.
  if (loserClaim && !winnerClaim) {
    await db.insert(candidateClaims).values({
      candidateId: winnerId,
      ownerUserId: loserClaim.ownerUserId,
      claimBasis: "manual_override",
    });
  }
  if (loserClaim) {
    await db
      .update(candidateClaims)
      .set({ status: "released", releasedAt: new Date(), releaseReason: `Merged into ${winner.fullName}` })
      .where(eq(candidateClaims.id, loserClaim.id));
  }

  await db.update(candidates).set({ mergedIntoId: winnerId }).where(eq(candidates.id, loserId));

  await db.insert(auditLog).values({
    actorUserId: session.user.id,
    entityType: "candidate",
    entityId: loserId,
    action: "merge",
    before: { mergedIntoId: null },
    after: { mergedIntoId: winnerId },
    reason:
      reason + (loserClaim && winnerClaim ? ` (claim collision: kept ${winner.fullName}'s existing claim)` : ""),
  });

  revalidatePath(`/candidates/${loserId}`);
  revalidatePath(`/candidates/${winnerId}`);
  revalidatePath("/candidates");
  return { ok: true };
}

export async function unmergeCandidatesAction(candidateId: string, reason: string): Promise<ActionResult> {
  const session = await requireUser();
  if (!reason.trim()) return { ok: false, error: "A reason is required to unmerge a candidate" };

  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
  if (!candidate) return { ok: false, error: "Candidate not found" };
  if (!candidate.mergedIntoId) return { ok: false, error: "This candidate was not merged" };

  const previousWinnerId = candidate.mergedIntoId;
  await db.update(candidates).set({ mergedIntoId: null }).where(eq(candidates.id, candidateId));

  await db.insert(auditLog).values({
    actorUserId: session.user.id,
    entityType: "candidate",
    entityId: candidateId,
    action: "unmerge",
    before: { mergedIntoId: previousWinnerId },
    after: { mergedIntoId: null },
    reason,
  });

  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath(`/candidates/${previousWinnerId}`);
  revalidatePath("/candidates");
  return { ok: true };
}

function optionalString(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? "").trim();
  return str.length > 0 ? str : null;
}

// postgres.js surfaces the Postgres error code as `.code`; 23505 is
// unique_violation. Narrower than a bare catch so a real DB/connection
// failure doesn't get silently reinterpreted as "already claimed."
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
