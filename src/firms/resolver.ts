import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { firms, firmAliases, firmEvents } from "@/db/schema";
import { normalizeEmployerString } from "./normalize";

export type ResolutionMethod = "exact" | "alias" | "fuzzy" | "none";

export interface FirmResolution {
  status: "resolved" | "needs_manual_review";
  firmId: string | null;
  confidence: number;
  method: ResolutionMethod;
  matchedName: string | null;
  normalizedInput: string;
}

// Spec 7.3 step 2c: "trigram similarity > 0.85". Below this, resolve()
// itself reports needs_manual_review rather than guessing.
const FUZZY_THRESHOLD = 0.85;

// The 3-tier resolver (spec 7.3 step 2). Exact and alias tiers are cheap
// index lookups; fuzzy only runs when neither finds anything, since a
// same-string match should never be second-guessed by a similarity score.
export async function resolveFirm(rawEmployerString: string): Promise<FirmResolution> {
  const normalizedInput = normalizeEmployerString(rawEmployerString);

  if (!normalizedInput) {
    return {
      status: "needs_manual_review",
      firmId: null,
      confidence: 0,
      method: "none",
      matchedName: null,
      normalizedInput,
    };
  }

  const [exactFirm] = await db
    .select({ id: firms.id, canonicalName: firms.canonicalName })
    .from(firms)
    .where(eq(firms.normalizedCanonicalName, normalizedInput));

  if (exactFirm) {
    return {
      status: "resolved",
      firmId: exactFirm.id,
      confidence: 1.0,
      method: "exact",
      matchedName: exactFirm.canonicalName,
      normalizedInput,
    };
  }

  const [aliasMatch] = await db
    .select({ firmId: firmAliases.firmId, alias: firmAliases.alias })
    .from(firmAliases)
    .where(eq(firmAliases.normalizedAlias, normalizedInput));

  if (aliasMatch) {
    return {
      status: "resolved",
      firmId: aliasMatch.firmId,
      confidence: 0.95,
      method: "alias",
      matchedName: aliasMatch.alias,
      normalizedInput,
    };
  }

  // Fuzzy tier: pg_trgm similarity() against both the normalized canonical
  // name and normalized aliases, taking the single best match across both.
  // Raw SQL because drizzle-orm has no query-builder helper for
  // similarity(); this is the one place in the resolver not exercised
  // through drizzle's typed API (see README "not machine-verified").
  interface FuzzyRow {
    id: string;
    matched_name: string;
    score: number;
  }

  const fuzzyRows = await db.execute(sql`
    (
      SELECT id, canonical_name AS matched_name, similarity(normalized_canonical_name, ${normalizedInput}) AS score
      FROM firms
      WHERE normalized_canonical_name IS NOT NULL
        AND similarity(normalized_canonical_name, ${normalizedInput}) > ${FUZZY_THRESHOLD}
    )
    UNION ALL
    (
      SELECT firm_id AS id, alias AS matched_name, similarity(normalized_alias, ${normalizedInput}) AS score
      FROM firm_aliases
      WHERE similarity(normalized_alias, ${normalizedInput}) > ${FUZZY_THRESHOLD}
    )
    ORDER BY score DESC
    LIMIT 1
  `);

  const best = (fuzzyRows as unknown as FuzzyRow[])[0];

  if (best) {
    return {
      status: "resolved",
      firmId: best.id,
      confidence: Number(best.score),
      method: "fuzzy",
      matchedName: best.matched_name,
      normalizedInput,
    };
  }

  return {
    status: "needs_manual_review",
    firmId: null,
    confidence: 0,
    method: "none",
    matchedName: null,
    normalizedInput,
  };
}

// Spec 8.1 step 1: "Resolve firm (7.3). Below 0.95 confidence -> manual
// review, hard stop." This is a separate, stricter gate than resolve()'s
// own 0.85 fuzzy cutoff -- resolve() can successfully find a fuzzy match
// (e.g. confidence 0.87) that still isn't good enough to act on
// automatically (acceptance criterion 11). Exact (1.0) and alias (0.95)
// tiers clear this bar; fuzzy matches almost never do.
export function requiresManualConfirmation(resolution: FirmResolution): boolean {
  return resolution.status !== "resolved" || resolution.confidence < 0.95;
}

export interface AcquisitionChainLink {
  firmId: string;
  eventType: "acquired_by" | "renamed" | "merged";
  announcedAt: Date | null;
  effectiveAt: Date | null;
}

export interface AcquisitionWalkResult {
  effectiveFirmId: string;
  chain: AcquisitionChainLink[];
  // OQ 2 default: acquired by another Top 100 firm, stays eligible;
  // acquired by a non-list firm, conditional pending manual review;
  // eligible throughout the transition window (announced_at through
  // effective_at + 12 months) regardless of which. null when the firm has
  // no acquisition/merger history to walk.
  eligibilityHint: "eligible" | "conditional" | null;
}

const MAX_WALK_HOPS = 5;
const TRANSITION_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

// Spec 7.3 step 3: "Walk firm_events for acquisitions and rebrands, apply
// the rule in OQ 2." Takes a resolved firmId and follows any acquired_by/
// merged chain to the current owner, applying the OQ 2 eligibility default
// at each hop. Bounded to MAX_WALK_HOPS as a safety net against a cyclic
// firm_events record, not because real chains run that deep.
export async function walkAcquisitionChain(
  firmId: string,
  asOf: Date = new Date(),
): Promise<AcquisitionWalkResult> {
  let currentId = firmId;
  const chain: AcquisitionChainLink[] = [];
  let eligibilityHint: AcquisitionWalkResult["eligibilityHint"] = null;

  for (let hop = 0; hop < MAX_WALK_HOPS; hop++) {
    const [event] = await db
      .select()
      .from(firmEvents)
      .where(
        and(eq(firmEvents.firmId, currentId), inArray(firmEvents.eventType, ["acquired_by", "merged"])),
      );

    if (!event || !event.counterpartyFirmId) break;

    chain.push({
      firmId: currentId,
      eventType: event.eventType,
      announcedAt: event.announcedAt,
      effectiveAt: event.effectiveAt,
    });

    const [counterparty] = await db
      .select({ id: firms.id, top100Rank: firms.top100Rank })
      .from(firms)
      .where(eq(firms.id, event.counterpartyFirmId));

    if (!counterparty) break;

    const transitionEnd = event.effectiveAt
      ? new Date(event.effectiveAt.getTime() + TRANSITION_WINDOW_MS)
      : null;
    const inTransition =
      event.announcedAt !== null &&
      transitionEnd !== null &&
      asOf >= event.announcedAt &&
      asOf <= transitionEnd;

    eligibilityHint = inTransition || counterparty.top100Rank !== null ? "eligible" : "conditional";
    currentId = counterparty.id;
  }

  return { effectiveFirmId: currentId, chain, eligibilityHint };
}
