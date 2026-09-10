// Identity resolution normalization (spec 3.2). Deliberately mechanical,
// not semantic -- zero external dependencies so it's runnable and testable
// without node_modules (see README "A note on this session's constraints").

// --- Names -------------------------------------------------------------------

// normalizedNameKey (person.normalized_name_key): the deterministic-tier
// comparison key for the fuzzy match's candidate-narrowing step, and for
// spotting obvious duplicates on the merge queue at a glance. Lowercase,
// strip punctuation, collapse whitespace, drop common suffixes (Jr/Sr/II/
// III/IV) so "Bob Smith Jr." and "Bob Smith" narrow to the same candidate
// set -- the fuzzy tier's similarity() call is what actually decides
// whether they're the same person, this is just narrowing.
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

export function normalizePersonName(raw: string): string {
  let s = raw.trim().toLowerCase();
  if (!s) return "";

  s = s.replace(/[^a-z0-9\s'-]/g, " ");
  let tokens = s.split(/\s+/).filter(Boolean);
  tokens = tokens.filter((t) => !NAME_SUFFIXES.has(t.replace(/\.$/, "")));

  return tokens.join(" ").trim();
}

// dedupFingerprint: normalized name + first employer token, e.g.
// "jane doe|acme". Narrows the fuzzy-match candidate set (spec 3.2 step 2:
// "name similarity plus matching current employer") before the expensive
// pg_trgm similarity() call runs -- see src/identity/resolver.ts.
export function computeDedupFingerprint(name: string, currentEmployer: string | null | undefined): string {
  const normalizedName = normalizePersonName(name);
  const employerToken = currentEmployer ? normalizeEmployerString(currentEmployer).split(" ")[0] ?? "" : "";
  return `${normalizedName}|${employerToken}`;
}

// --- Employer / brokerage names -----------------------------------------------
// Same mechanical normalization approach as person names: lowercase, strip
// punctuation and legal suffixes, expand a small non-exhaustive abbreviation
// set. There is no firm-alias/M&A-event resolver in this MVP (the v3.0
// brokerage table is just name/rank/rank_source, not the richer alias+
// acquisition graph an earlier draft of this system explored) -- this
// function backs brokerage.normalized_name's uniqueness and the narrow
// importer's brokerage-matching step only.
const ABBREVIATION_EXPANSIONS: Record<string, string> = {
  intl: "international",
  ins: "insurance",
  svcs: "services",
  svc: "service",
  mgmt: "management",
  assoc: "associates",
  assocs: "associates",
};

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

  s = s.toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9\s]/g, " ");

  let tokens = s.split(/\s+/).filter(Boolean);
  tokens = tokens.map((t) => ABBREVIATION_EXPANSIONS[t] ?? t);
  tokens = tokens.filter((t) => !STRIP_TOKENS.has(t));

  return tokens.join(" ").trim();
}

// --- Identifiers ---------------------------------------------------------------
// Backs person_identifier.normalized_value, which the deterministic-match
// tier's UNIQUE(type, normalized_value) constraint enforces (spec 3.2
// step 1).

export function normalizeIdentifier(type: "email" | "phone" | "linkedin_url" | "legacy_id", value: string): string {
  const v = value.trim();
  switch (type) {
    case "email":
      return v.toLowerCase();
    case "phone":
      return v.replace(/[^0-9]/g, "").replace(/^1(?=\d{10}$)/, ""); // strip US country code
    case "linkedin_url":
      return v
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/+$/, "");
    case "legacy_id":
      return v;
  }
}
