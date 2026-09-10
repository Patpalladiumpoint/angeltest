"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { firms, engagements, auditLog } from "@/db/schema";
import { requireUser } from "@/auth/requireAdmin";
import { normalizeEmployerString } from "./normalize";
import type { ActionResult } from "@/lib/actions";

export async function createFirmAction(formData: FormData): Promise<ActionResult> {
  await requireUser();
  const canonicalName = String(formData.get("canonicalName") ?? "").trim();
  if (!canonicalName) return { ok: false, error: "Firm name is required" };

  const top100RankRaw = String(formData.get("top100Rank") ?? "").trim();
  const top100RankParsed = top100RankRaw ? Number(top100RankRaw) : null;
  const top100Rank = top100RankParsed !== null && Number.isFinite(top100RankParsed) ? top100RankParsed : null;

  // Every firm needs a normalized name the resolver can match against --
  // manually added firms go through the exact same normalization as the
  // seeded Top 100 list (src/firms/resolver.ts), not a separate path.
  await db.insert(firms).values({
    canonicalName,
    normalizedCanonicalName: normalizeEmployerString(canonicalName),
    top100Rank,
  });

  revalidatePath("/firms");
  return { ok: true };
}

// Record only (spec 5 "Firms and clients") -- Phase 3 scope. Nothing yet
// reads off_limits_scope/off_limits_expires_at to actually gate a claim or
// a send; that's Phase 5. See schema.ts's comment on the engagements table.
export async function createEngagementAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const firmId = String(formData.get("firmId") ?? "");
  if (!firmId) return { ok: false, error: "Firm is required" };

  const engagementType = String(formData.get("engagementType") ?? "retained") as
    | "retained"
    | "contingent"
    | "consulting";
  const offLimitsScope = String(formData.get("offLimitsScope") ?? "firm_wide") as
    | "firm_wide"
    | "division"
    | "named_individuals"
    | "none";
  const termsNotes = optionalString(formData.get("termsNotes"));

  const [engagement] = await db
    .insert(engagements)
    .values({ firmId, engagementType, offLimitsScope, termsNotes, createdBy: session.user.id })
    .returning({ id: engagements.id });

  await db.insert(auditLog).values({
    actorUserId: session.user.id,
    entityType: "engagement",
    entityId: engagement!.id,
    action: "create",
    after: { firmId, engagementType, offLimitsScope, termsNotes },
  });

  revalidatePath(`/firms/${firmId}`);
  return { ok: true };
}

function optionalString(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? "").trim();
  return str.length > 0 ? str : null;
}
