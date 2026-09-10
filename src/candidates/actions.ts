"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import {
  candidates,
  firms,
  candidateClaims,
  contactLedger,
  auditLog,
  users,
  GLOBAL_CONTACT_COOLDOWN_DAYS,
} from "@/db/schema";
import { requireUser } from "@/auth/requireAdmin";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function createFirmAction(formData: FormData): Promise<ActionResult> {
  await requireUser();
  const canonicalName = String(formData.get("canonicalName") ?? "").trim();
  if (!canonicalName) return { ok: false, error: "Firm name is required" };

  const top100RankRaw = String(formData.get("top100Rank") ?? "").trim();
  const top100RankParsed = top100RankRaw ? Number(top100RankRaw) : null;
  const top100Rank = top100RankParsed !== null && Number.isFinite(top100RankParsed) ? top100RankParsed : null;

  await db.insert(firms).values({ canonicalName, top100Rank });
  revalidatePath("/firms");
  return { ok: true };
}

export async function createCandidateAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!fullName) return { ok: false, error: "Name is required" };

  const currentTitle = optionalString(formData.get("currentTitle"));
  const currentFirmRaw = optionalString(formData.get("currentFirmRaw"));
  const linkedinUrl = optionalString(formData.get("linkedinUrl"));
  const resolvedFirmId = optionalString(formData.get("resolvedFirmId"));

  const [candidate] = await db
    .insert(candidates)
    .values({
      fullName,
      currentTitle,
      currentFirmRaw,
      linkedinUrl,
      resolvedFirmId,
      createdBy: session.user.id,
    })
    .returning({ id: candidates.id });

  await db.insert(auditLog).values({
    actorUserId: session.user.id,
    entityType: "candidate",
    entityId: candidate!.id,
    action: "create",
    after: { fullName, currentTitle, currentFirmRaw },
  });

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
