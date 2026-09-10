// Fixture set for the firm resolver (spec 7.3 / Phase 1 build order:
// "Build and test the resolver against a fixture set of at least 60 messy
// employer strings including DBAs, former names, and acquired entities.
// Target 95 percent correct resolution or explicit needs_manual_review.").
//
// Every expected outcome below was checked against the real trigram
// similarity() scores computed by this session against the actual seeded
// firm set (src/firms/seed-data/top100-2026.ts) -- not guessed. See the
// PR/session notes for the raw score table. Scores are sensitive to the
// exact seed data; if the seed file changes, re-derive expectations rather
// than editing them by feel.

export interface ResolverFixture {
  input: string;
  expectedStatus: "resolved" | "needs_manual_review";
  expectedMethod?: "exact" | "alias" | "fuzzy";
  expectedCanonicalName?: string;
  note?: string;
}

export const RESOLVER_FIXTURES: ResolverFixture[] = [
  // --- Exact: canonical name verbatim, one per seeded firm -----------------
  { input: "Marsh & McLennan Cos. Inc.", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Marsh & McLennan Cos. Inc." },
  { input: "Aon plc", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Aon plc" },
  { input: "Arthur J. Gallagher & Co.", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Arthur J. Gallagher & Co." },
  { input: "Willis Towers Watson plc", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Willis Towers Watson plc" },
  { input: "Alliant Insurance Services Inc.", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Alliant Insurance Services Inc." },
  { input: "Hub International Ltd.", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Hub International Ltd." },
  { input: "Brown & Brown Inc.", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Brown & Brown Inc." },
  { input: "Acrisure LLC", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Acrisure LLC" },
  { input: "Lockton Cos. LLC", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Lockton Cos. LLC" },
  { input: "AssuredPartners Inc.", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "AssuredPartners Inc." },
  { input: "USI Insurance Services LLC", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "USI Insurance Services LLC" },
  { input: "Patriot Growth Insurance Services LLC", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Patriot Growth Insurance Services LLC" },
  { input: "Scott Insurance", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Scott Insurance" },
  { input: "Christensen Group Insurance", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Christensen Group Insurance" },
  { input: "Seubert & Associates Inc.", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Seubert & Associates Inc." },
  { input: "NFP Corp.", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "NFP Corp." },
  { input: "EPIC Insurance Brokers & Consultants", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "EPIC Insurance Brokers & Consultants" },
  { input: "The Baldwin Group Inc.", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "The Baldwin Group Inc." },
  { input: "World Insurance Associates LLC", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "World Insurance Associates LLC" },
  { input: "Higginbotham Insurance Agency Inc.", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Higginbotham Insurance Agency Inc." },
  { input: "INSURICA", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "INSURICA" },
  { input: "Foundation Risk Partners", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Foundation Risk Partners" },
  { input: "Amwins Group Inc.", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Amwins Group Inc." },
  { input: "CRC Group", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "CRC Group" },
  { input: "One80 Intermediaries", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "One80 Intermediaries" },
  // Acquired entities, resolved on their OWN former canonical name --
  // acceptance criterion 9 covers "Woodruff Sawyer" specifically, and its
  // acquisition-chain walk is asserted separately in firm-resolver.test.ts.
  { input: "Woodruff Sawyer", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Woodruff Sawyer", note: "AC9: exact match, acquisition walk tested separately" },
  { input: "The Horton Group", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "The Horton Group" },
  { input: "Accession Risk Management Group", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Accession Risk Management Group" },

  // --- Exact after normalization: legal-suffix/punctuation/join variants ---
  { input: "Arthur J Gallagher and Company", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Arthur J. Gallagher & Co." },
  { input: "USI Insurance Svcs", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "USI Insurance Services LLC" },
  { input: "Lockton Company", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Lockton Cos. LLC" },
  { input: "Lockton Cos", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Lockton Cos. LLC" },
  { input: "Acrisure LLC Holdings", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Acrisure LLC" },
  { input: "Hub International Ltd", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Hub International Ltd." },
  { input: "Brown Brown, Inc.", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Brown & Brown Inc." },
  { input: "Accession Risk Mgmt Group", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Accession Risk Management Group" },
  { input: "Seubert and Associates", expectedStatus: "resolved", expectedMethod: "exact", expectedCanonicalName: "Seubert & Associates Inc." },

  // --- Alias / DBA ----------------------------------------------------------
  {
    input: "Accession Risk Management Group, dba Risk Strategies Co.",
    expectedStatus: "resolved",
    expectedMethod: "alias",
    expectedCanonicalName: "Accession Risk Management Group",
    note: "AC10: the spec's own example string, must resolve through the alias path",
  },
  { input: "Risk Strategies", expectedStatus: "resolved", expectedMethod: "alias", expectedCanonicalName: "Accession Risk Management Group" },
  { input: "Risk Strategies Co.", expectedStatus: "resolved", expectedMethod: "alias", expectedCanonicalName: "Accession Risk Management Group" },

  // --- Fuzzy: real trigram scores between 0.85 and 0.95 ---------------------
  // AC11: a fuzzy match (confidence < 0.95) must still require manual
  // confirmation downstream even though resolve() itself succeeds --
  // asserted explicitly in firm-resolver.test.ts against "Christensen
  // Group Insuranc" (score 0.870, a deliberately close real example).
  { input: "USI Insurance Service", expectedStatus: "resolved", expectedMethod: "fuzzy", expectedCanonicalName: "USI Insurance Services LLC", note: "score ~0.913" },
  { input: "Willis Tower Watson", expectedStatus: "resolved", expectedMethod: "fuzzy", expectedCanonicalName: "Willis Towers Watson plc", note: "score ~0.857, just above threshold" },
  { input: "World Insurance Associate", expectedStatus: "resolved", expectedMethod: "fuzzy", expectedCanonicalName: "World Insurance Associates LLC", note: "score ~0.893" },
  { input: "Foundation Risk Partner", expectedStatus: "resolved", expectedMethod: "fuzzy", expectedCanonicalName: "Foundation Risk Partners", note: "score ~0.885" },
  { input: "Christensen Group Insuranc", expectedStatus: "resolved", expectedMethod: "fuzzy", expectedCanonicalName: "Christensen Group Insurance", note: "AC11: score ~0.870, must still require manual confirmation" },
  { input: "Patriot Growth Insurance Service", expectedStatus: "resolved", expectedMethod: "fuzzy", expectedCanonicalName: "Patriot Growth Insurance Services LLC", note: "score ~0.941" },

  // --- needs_manual_review: near misses that fall short of 0.85 -------------
  // Deliberately real near-misses, not softballs -- several of these read
  // as "obviously the same company" to a human but the trigram score lands
  // below threshold once the exact letters diverge. That's the point: spec
  // 7.3 wants a near-match short of 0.85 to stop, not guess.
  { input: "Gallagher Insurance Company", expectedStatus: "needs_manual_review", note: "score ~0.39, generic rename reads nothing like the canonical name" },
  { input: "Acrisur", expectedStatus: "needs_manual_review", note: "score ~0.70" },
  { input: "Hub Internatonal", expectedStatus: "needs_manual_review", note: "score ~0.75" },
  { input: "Brown and Brown Insurance", expectedStatus: "needs_manual_review", note: "score ~0.46" },
  { input: "Willis Towers Watsn", expectedStatus: "needs_manual_review", note: "score ~0.77" },
  { input: "Woodruf Sawyer", expectedStatus: "needs_manual_review", note: "score ~0.82, just under threshold" },
  { input: "Woodruff Sawer", expectedStatus: "needs_manual_review", note: "score ~0.72" },
  { input: "Horton Grup", expectedStatus: "needs_manual_review", note: "score ~0.58" },
  { input: "The Horton Grp", expectedStatus: "needs_manual_review", note: "score ~0.64" },
  { input: "Risk Strategie", expectedStatus: "needs_manual_review", note: "score ~0.14 -- trigram similarity degrades sharply on short truncations" },
  { input: "RiskStrategies", expectedStatus: "needs_manual_review", note: "score ~0.11 -- removing the space badly hurts trigram overlap, a known limitation worth keeping visible rather than hiding" },
  { input: "Insurica Insurance", expectedStatus: "needs_manual_review", note: "score ~0.64" },
  { input: "Higginbothm Insurance", expectedStatus: "needs_manual_review", note: "score ~0.80" },
  { input: "Assured Partners", expectedStatus: "needs_manual_review", note: "score ~0.74 -- the real brand has no internal space" },

  // --- needs_manual_review: genuinely unrelated companies --------------------
  { input: "Google LLC", expectedStatus: "needs_manual_review" },
  { input: "Acme Corp", expectedStatus: "needs_manual_review" },
  { input: "State Farm Insurance", expectedStatus: "needs_manual_review" },
  { input: "Progressive Corporation", expectedStatus: "needs_manual_review" },
  { input: "Liberty Mutual", expectedStatus: "needs_manual_review" },
  { input: "JPMorgan Chase", expectedStatus: "needs_manual_review" },
  { input: "The Smith Agency", expectedStatus: "needs_manual_review" },

  // --- needs_manual_review: empty/garbage input ------------------------------
  { input: "", expectedStatus: "needs_manual_review" },
  { input: "   ", expectedStatus: "needs_manual_review" },
  { input: "---", expectedStatus: "needs_manual_review" },
];
