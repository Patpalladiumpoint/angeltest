import { db } from "@/db/client";
import { firms, firmAliases, firmEvents, engagements, candidates, users } from "@/db/schema";
import { eq, or, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export async function getFirmDetail(firmId: string) {
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  if (!firm) return null;

  const parent = firm.parentFirmId
    ? (await db.select().from(firms).where(eq(firms.id, firm.parentFirmId)))[0] ?? null
    : null;

  const aliases = await db.select().from(firmAliases).where(eq(firmAliases.firmId, firmId));

  // Events where this firm is the subject ("acquired by X") and where it's
  // the counterparty ("acquired Y") -- a Top 100 firm is far more often the
  // latter, and the firm detail page should show both directions.
  const counterparty = alias(firms, "counterparty_firm");
  const subjectFirm = alias(firms, "subject_firm");
  const events = await db
    .select({
      id: firmEvents.id,
      eventType: firmEvents.eventType,
      announcedAt: firmEvents.announcedAt,
      effectiveAt: firmEvents.effectiveAt,
      sourceUrl: firmEvents.sourceUrl,
      subjectFirmId: firmEvents.firmId,
      subjectFirmName: subjectFirm.canonicalName,
      counterpartyFirmId: firmEvents.counterpartyFirmId,
      counterpartyFirmName: counterparty.canonicalName,
    })
    .from(firmEvents)
    .innerJoin(subjectFirm, eq(firmEvents.firmId, subjectFirm.id))
    .leftJoin(counterparty, eq(firmEvents.counterpartyFirmId, counterparty.id))
    .where(or(eq(firmEvents.firmId, firmId), eq(firmEvents.counterpartyFirmId, firmId)))
    .orderBy(desc(firmEvents.effectiveAt));

  const firmEngagements = await db
    .select({
      id: engagements.id,
      engagementType: engagements.engagementType,
      status: engagements.status,
      startedAt: engagements.startedAt,
      endedAt: engagements.endedAt,
      offLimitsScope: engagements.offLimitsScope,
      offLimitsExpiresAt: engagements.offLimitsExpiresAt,
      termsNotes: engagements.termsNotes,
      createdByEmail: users.email,
    })
    .from(engagements)
    .leftJoin(users, eq(engagements.createdBy, users.id))
    .where(eq(engagements.firmId, firmId))
    .orderBy(desc(engagements.startedAt));

  const candidatesAtFirm = await db
    .select({ id: candidates.id, fullName: candidates.fullName, currentTitle: candidates.currentTitle })
    .from(candidates)
    .where(eq(candidates.resolvedFirmId, firmId))
    .limit(50);

  return { firm, parent, aliases, events, engagements: firmEngagements, candidatesAtFirm };
}
