// Employer-string normalization (spec 7.3 step 1): "lowercase, strip
// punctuation and legal suffixes (Inc, LLC, Co, Group, Agency, Holdings),
// expand abbreviations, strip 'dba' prefixes."
//
// This is deliberately mechanical, not semantic. Real rebrands (e.g. an
// operating name replacing a legal one) are handled by firm_aliases and
// firm_events, not by trying to make the normalizer smart enough to know
// two different strings mean the same company -- that's exactly the job
// the alias/fuzzy tiers in resolver.ts exist to do.

// Not an exhaustive abbreviation dictionary -- there is no canonical list
// to verify this against (working agreement: "verify against live
// documentation," but no such source exists for informal ATS abbreviation
// conventions). Token-by-token expansion, never substring replacement, so
// "ins" never corrupts a word like "Robins."
const ABBREVIATION_EXPANSIONS: Record<string, string> = {
  intl: "international",
  ins: "insurance",
  svcs: "services",
  svc: "service",
  mgmt: "management",
  assoc: "associates",
  assocs: "associates",
};

// Legal suffixes (spec's own list) plus generic stopwords ("the", "and",
// "of") that would otherwise make two references to the same firm compare
// unequal purely because one has "&"/"The" and the other doesn't.
const STRIP_TOKENS = new Set([
  "the",
  "and",
  "of",
  "inc",
  "incorporated",
  "llc",
  "lc",
  "llp",
  "lp",
  "plc",
  "ltd",
  "limited",
  "co",
  "cos",
  "corp",
  "corporation",
  "company",
  "companies",
  "group",
  "agency",
  "holdings",
]);

export function normalizeEmployerString(raw: string): string {
  let s = raw.trim();
  if (!s) return "";

  // Strip a "dba" prefix: "Parent Co, dba Operating Name" -> keep only the
  // operating name that follows "dba". Spec 7.3 example:
  // "Accession Risk Management Group, dba Risk Strategies Co." should
  // resolve on "Risk Strategies", not the parent name.
  const dbaMatch = s.match(/\bdba\b/i);
  if (dbaMatch?.index !== undefined) {
    s = s.slice(dbaMatch.index + dbaMatch[0].length);
  }

  // Drop a "(now X)" / "(formerly X)" human annotation -- status
  // commentary, not part of the name. The resolver uses firm_events for
  // this, not prose left in a legacy ATS field.
  s = s.replace(/\((?:now|formerly)[^)]*\)/gi, " ");

  s = s.toLowerCase();
  s = s.replace(/&/g, " and "); // expand before stripping punctuation
  s = s.replace(/[^a-z0-9\s]/g, " "); // drop remaining punctuation

  let tokens = s.split(/\s+/).filter(Boolean);
  tokens = tokens.map((t) => ABBREVIATION_EXPANSIONS[t] ?? t);
  tokens = tokens.filter((t) => !STRIP_TOKENS.has(t));

  return tokens.join(" ").trim();
}
