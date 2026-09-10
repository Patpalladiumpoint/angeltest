import { db } from "@/db/client";
import { systemSettings, auditLog, SYSTEM_SETTINGS_SINGLETON_ID } from "@/db/schema";
import { eq } from "drizzle-orm";

// Spec 3.1: "Global kill switch (system_settings.outbound_enabled) halts all
// sends within one polling interval." The send worker (Phase 11) must call
// isOutboundEnabled() on every poll -- caching this value defeats the point.
export async function isOutboundEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ outboundEnabled: systemSettings.outboundEnabled })
    .from(systemSettings)
    .where(eq(systemSettings.id, SYSTEM_SETTINGS_SINGLETON_ID));

  // Fail closed: if the settings row is somehow missing, treat outbound as
  // disabled rather than defaulting to "send anyway."
  return row?.outboundEnabled ?? false;
}

export async function setOutboundEnabled(params: {
  enabled: boolean;
  actorUserId: string;
  reason: string;
}): Promise<void> {
  const { enabled, actorUserId, reason } = params;

  const [before] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.id, SYSTEM_SETTINGS_SINGLETON_ID));

  await db
    .update(systemSettings)
    .set({ outboundEnabled: enabled, updatedAt: new Date(), updatedBy: actorUserId })
    .where(eq(systemSettings.id, SYSTEM_SETTINGS_SINGLETON_ID));

  await db.insert(auditLog).values({
    actorUserId,
    entityType: "system_settings",
    entityId: String(SYSTEM_SETTINGS_SINGLETON_ID),
    action: enabled ? "outbound_enabled" : "outbound_disabled",
    before: before ?? null,
    after: { ...before, outboundEnabled: enabled },
    reason,
  });
}
