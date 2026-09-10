#!/usr/bin/env tsx
// Loads the versioned Top 100 seed data (spec 7.3) into firms, firm_aliases,
// and firm_events. Re-runnable: matches existing rows by normalized name
// rather than inserting duplicates, so running this after editing the seed
// file updates in place instead of piling up records.
import { eq } from "drizzle-orm";
import { db, queryClient } from "./client";
import { firms, firmAliases, firmEvents } from "./schema";
import { normalizeEmployerString } from "@/firms/normalize";
import { TOP100_FIRMS, FIRM_EVENTS, TOP100_LIST_YEAR } from "@/firms/seed-data/top100-2026";

export async function seedFirms(): Promise<void> {
  const idByCanonicalName = new Map<string, string>();

  // Pass 1: insert/update every firm by its normalized name, without
  // parent_firm_id yet -- a firm's parent may not exist as a row until a
  // later entry in this same pass.
  for (const seedFirm of TOP100_FIRMS) {
    const normalized = normalizeEmployerString(seedFirm.canonicalName);

    const [existing] = await db
      .select({ id: firms.id, canonicalName: firms.canonicalName })
      .from(firms)
      .where(eq(firms.normalizedCanonicalName, normalized));

    let firmId: string;
    if (existing) {
      // Two DIFFERENT seed entries normalizing to the same string is a real
      // failure mode, not a no-op update -- found by testing this exact
      // seed data (Marsh McLennan Agency LLC vs. Marsh & McLennan Cos.
      // Inc. both stripped to "marsh mclennan" once "Agency" is treated as
      // a legal suffix, per spec 7.3). Silently overwriting one firm's
      // canonicalName with another's would corrupt the record; fail loudly
      // instead (working agreement: "Prefer explicit failure over silent
      // degradation").
      if (existing.canonicalName !== seedFirm.canonicalName) {
        throw new Error(
          `Seed data collision: "${seedFirm.canonicalName}" and "${existing.canonicalName}" both normalize ` +
            `to "${normalized}". Rename one, or model them as an alias/parent relationship instead of two ` +
            `top-level firms.`,
        );
      }
      firmId = existing.id;
      await db
        .update(firms)
        .set({
          top100Rank: seedFirm.rank,
          top100ListYear: seedFirm.listYear,
          firmType: seedFirm.firmType,
        })
        .where(eq(firms.id, firmId));
    } else {
      const [inserted] = await db
        .insert(firms)
        .values({
          canonicalName: seedFirm.canonicalName,
          normalizedCanonicalName: normalized,
          top100Rank: seedFirm.rank,
          top100ListYear: seedFirm.listYear,
          firmType: seedFirm.firmType,
        })
        .returning({ id: firms.id });
      firmId = inserted!.id;
    }

    idByCanonicalName.set(seedFirm.canonicalName, firmId);
  }

  console.log(`Seeded ${TOP100_FIRMS.length} firms (Top 100 list year ${TOP100_LIST_YEAR}).`);

  // Pass 2: corporate-parent links (e.g. Marsh McLennan Agency -> Marsh &
  // McLennan Cos.) -- distinct from acquisition events, see seed-data file.
  for (const seedFirm of TOP100_FIRMS) {
    if (!seedFirm.parentCanonicalName) continue;
    const firmId = idByCanonicalName.get(seedFirm.canonicalName);
    const parentId = idByCanonicalName.get(seedFirm.parentCanonicalName);
    if (!firmId || !parentId) {
      throw new Error(
        `Seed data error: "${seedFirm.canonicalName}" references unknown parent "${seedFirm.parentCanonicalName}"`,
      );
    }
    await db.update(firms).set({ parentFirmId: parentId }).where(eq(firms.id, firmId));
  }

  // Pass 3: aliases.
  let aliasCount = 0;
  for (const seedFirm of TOP100_FIRMS) {
    if (!seedFirm.aliases) continue;
    const firmId = idByCanonicalName.get(seedFirm.canonicalName);
    if (!firmId) continue;

    for (const alias of seedFirm.aliases) {
      const normalizedAlias = normalizeEmployerString(alias.alias);
      const [existingAlias] = await db
        .select({ id: firmAliases.id })
        .from(firmAliases)
        .where(eq(firmAliases.normalizedAlias, normalizedAlias));

      if (!existingAlias) {
        await db.insert(firmAliases).values({
          firmId,
          alias: alias.alias,
          aliasType: alias.aliasType,
          normalizedAlias,
        });
        aliasCount += 1;
      }
    }
  }
  console.log(`Seeded ${aliasCount} new firm alias(es).`);

  // Pass 4: acquisition/rebrand events, and mark the acquired firm's status
  // and parent_firm_id -- both derivable from the event, spec's own
  // philosophy of "compute it, do not maintain it by hand" applied here.
  let eventCount = 0;
  for (const seedEvent of FIRM_EVENTS) {
    const firmId = idByCanonicalName.get(seedEvent.firmCanonicalName);
    const counterpartyId = idByCanonicalName.get(seedEvent.counterpartyCanonicalName);
    if (!firmId || !counterpartyId) {
      throw new Error(
        `Seed data error: event references unknown firm "${seedEvent.firmCanonicalName}" or counterparty "${seedEvent.counterpartyCanonicalName}"`,
      );
    }

    const [existingEvent] = await db
      .select({ id: firmEvents.id })
      .from(firmEvents)
      .where(eq(firmEvents.firmId, firmId));

    if (!existingEvent) {
      await db.insert(firmEvents).values({
        firmId,
        eventType: seedEvent.eventType,
        counterpartyFirmId: counterpartyId,
        announcedAt: new Date(seedEvent.announcedAt),
        effectiveAt: new Date(seedEvent.effectiveAt),
        sourceUrl: seedEvent.sourceUrl,
      });
      eventCount += 1;
    }

    const newStatus = seedEvent.eventType === "renamed" ? "renamed" : "acquired";
    await db
      .update(firms)
      .set({ status: newStatus, parentFirmId: counterpartyId })
      .where(eq(firms.id, firmId));
  }
  console.log(`Seeded ${eventCount} new firm event(s).`);
}

if (require.main === module) {
  seedFirms()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => queryClient.end());
}
