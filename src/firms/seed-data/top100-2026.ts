// Versioned Top 100 seed data (spec 7.3: "Build the seed as a versioned
// data file with top100_list_year. Make the annual refresh a documented,
// repeatable task."). This is TOP100_LIST_YEAR 2026 -- a new file should
// land next year (top100-2027.ts) rather than editing this one in place,
// so a candidate resolved against last year's list stays traceable to it.
//
// PROVENANCE, please read before trusting this data:
//
// This file was built in a sandboxed session using live web search, not
// the actual Business Insurance Top 100 U.S. Brokers subscription list
// (businessinsurance.com and the underlying PDF were both blocked by this
// session's network egress policy -- only search snippets were reachable).
// Two different tiers of confidence live in this file:
//
//   - `rank`/`listYear` set (not null): the specific rank and list year
//     came from a search result that named both, in this session
//     (2026-09-10) -- e.g. Patriot Growth Insurance Services at #25 on the
//     2025 list. Still worth spot-checking against the subscription list
//     before using ranks for real eligibility decisions.
//   - `rank`/`listYear` null: a real, well-known firm in this space, but no
//     specific rank/year was verified this session. Good enough to seed
//     the firm graph and exercise the resolver; not good enough to assert
//     "this firm is #N on the current list."
//
// The three acquisition events below (Woodruff Sawyer, The Horton Group,
// Accession Risk Management Group) ARE fully verified against live sources
// this session -- dates and source URLs are real, not placeholders. They
// were chosen because the spec itself names two of them verbatim as
// examples (7.3: "Woodruff Sawyer (now Gallagher)", "Horton Group (now
// MMA)", "Accession Risk Management Group, dba Risk Strategies Co.") and
// because acceptance criteria 9 and 10 test resolution against exactly
// these names.

export const TOP100_LIST_YEAR = 2026;

export type FirmType = "brokerage" | "carrier" | "mga" | "other";
export type FirmAliasType = "dba" | "former_name" | "abbreviation" | "misspelling";
export type FirmEventType = "acquired_by" | "renamed" | "merged";

export interface SeedFirmAlias {
  alias: string;
  aliasType: FirmAliasType;
}

export interface SeedFirm {
  canonicalName: string;
  rank: number | null;
  listYear: number | null;
  firmType: FirmType;
  parentCanonicalName?: string; // corporate parent, not an acquisition event
  aliases?: SeedFirmAlias[];
}

export interface SeedFirmEvent {
  firmCanonicalName: string;
  eventType: FirmEventType;
  counterpartyCanonicalName: string;
  announcedAt: string; // ISO date
  effectiveAt: string; // ISO date
  sourceUrl: string;
}

export const TOP100_FIRMS: SeedFirm[] = [
  // Verified rank + year this session (search results named both).
  { canonicalName: "Marsh & McLennan Cos. Inc.", rank: 1, listYear: 2025, firmType: "brokerage" },
  { canonicalName: "Aon plc", rank: 2, listYear: 2025, firmType: "brokerage" },
  { canonicalName: "Arthur J. Gallagher & Co.", rank: 3, listYear: 2025, firmType: "brokerage" },
  { canonicalName: "Willis Towers Watson plc", rank: 4, listYear: 2025, firmType: "brokerage" },
  { canonicalName: "Alliant Insurance Services Inc.", rank: 5, listYear: 2025, firmType: "brokerage" },
  { canonicalName: "Hub International Ltd.", rank: 6, listYear: 2025, firmType: "brokerage" },
  { canonicalName: "Brown & Brown Inc.", rank: 7, listYear: 2025, firmType: "brokerage" },
  { canonicalName: "Acrisure LLC", rank: 8, listYear: 2025, firmType: "brokerage" },
  { canonicalName: "Lockton Cos. LLC", rank: 9, listYear: 2025, firmType: "brokerage" },
  { canonicalName: "AssuredPartners Inc.", rank: 10, listYear: 2025, firmType: "brokerage" },
  { canonicalName: "USI Insurance Services LLC", rank: 11, listYear: 2025, firmType: "brokerage" },
  {
    canonicalName: "Patriot Growth Insurance Services LLC",
    rank: 25,
    listYear: 2025,
    firmType: "brokerage",
  },
  { canonicalName: "Scott Insurance", rank: 55, listYear: 2025, firmType: "brokerage" },
  {
    canonicalName: "Christensen Group Insurance",
    rank: 66,
    listYear: 2025,
    firmType: "brokerage",
  },
  {
    canonicalName: "Seubert & Associates Inc.",
    rank: 91,
    listYear: 2026,
    firmType: "brokerage",
  },

  // Real, well-known firms in this space; rank/year not verified this
  // session (see provenance note above).
  { canonicalName: "NFP Corp.", rank: null, listYear: null, firmType: "brokerage" },
  { canonicalName: "EPIC Insurance Brokers & Consultants", rank: null, listYear: null, firmType: "brokerage" },
  { canonicalName: "The Baldwin Group Inc.", rank: null, listYear: null, firmType: "brokerage" },
  { canonicalName: "World Insurance Associates LLC", rank: null, listYear: null, firmType: "brokerage" },
  { canonicalName: "Higginbotham Insurance Agency Inc.", rank: null, listYear: null, firmType: "brokerage" },
  { canonicalName: "INSURICA", rank: null, listYear: null, firmType: "brokerage" },
  { canonicalName: "Foundation Risk Partners", rank: null, listYear: null, firmType: "brokerage" },
  { canonicalName: "Amwins Group Inc.", rank: null, listYear: null, firmType: "brokerage" },
  { canonicalName: "CRC Group", rank: null, listYear: null, firmType: "brokerage" },
  { canonicalName: "One80 Intermediaries", rank: null, listYear: null, firmType: "brokerage" },

  // Marsh McLennan Agency (the actual named acquirer in the Horton Group
  // deal below) is deliberately NOT a separate top-level firm row here: it
  // is Marsh & McLennan's middle-market retail division, has no
  // independent Top 100 ranking of its own, and -- found by actually
  // running normalizeEmployerString() against this file -- "Marsh McLennan
  // Agency LLC" and "Marsh & McLennan Cos. Inc." normalize to the identical
  // string once "Agency"/"LLC" are stripped as legal suffixes (spec 7.3).
  // Modeling it as its own row would either collide with its parent under
  // normalization or need an artificial name tweak to avoid that -- neither
  // is worth it for a subsidiary with no independent ranking. Real
  // candidate resumes naming "Marsh McLennan Agency" specifically would be
  // exactly the kind of case the alias table or a firm_events "renamed"
  // entry exists for, once that distinction actually matters to a search.
  //
  // The three verified acquisitions (see firm_events below). Each of these
  // firms keeps its own record with status "acquired" -- a candidate's
  // resume can still say the old name, and the resolver needs a firm row
  // to resolve onto before it can walk the acquisition chain.
  { canonicalName: "Woodruff Sawyer", rank: null, listYear: null, firmType: "brokerage" },
  { canonicalName: "The Horton Group", rank: 55, listYear: 2024, firmType: "brokerage" },
  {
    canonicalName: "Accession Risk Management Group",
    rank: null,
    listYear: null,
    firmType: "brokerage",
    aliases: [{ alias: "Risk Strategies", aliasType: "dba" }],
  },
];

export const FIRM_EVENTS: SeedFirmEvent[] = [
  {
    firmCanonicalName: "Woodruff Sawyer",
    eventType: "acquired_by",
    counterpartyCanonicalName: "Arthur J. Gallagher & Co.",
    announcedAt: "2025-03-04",
    effectiveAt: "2025-04-10",
    sourceUrl: "https://www.insurancejournal.com/news/national/2025/04/11/819478.htm",
  },
  {
    // The real acquirer named in the source is "Marsh McLennan Agency";
    // recorded against its parent here -- see the seed-data comment above
    // on why MMA isn't its own row.
    firmCanonicalName: "The Horton Group",
    eventType: "acquired_by",
    counterpartyCanonicalName: "Marsh & McLennan Cos. Inc.",
    announcedAt: "2024-07-09",
    effectiveAt: "2024-08-01",
    sourceUrl:
      "https://www.marshmma.com/us/insights/details/mma-completes-acquisition-of-the-horton-group-inc.html",
  },
  {
    firmCanonicalName: "Accession Risk Management Group",
    eventType: "acquired_by",
    counterpartyCanonicalName: "Brown & Brown Inc.",
    announcedAt: "2025-06-10",
    effectiveAt: "2025-08-01",
    sourceUrl: "https://www.nasdaq.com/press-release/brown-brown-inc-completes-acquisition-accession-risk-management-group-2025-08-01",
  },
];
