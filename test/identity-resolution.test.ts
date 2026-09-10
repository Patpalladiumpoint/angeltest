import { describe, it, expect } from "vitest";
import { normalizePersonName, normalizeEmployerString, normalizeIdentifier, computeDedupFingerprint } from "@/identity/normalize";

// Pure-function unit tests -- zero dependencies, runnable without a
// database. Verified directly via the globally available ts-node in this
// session (see scratch test output referenced in README) since vitest
// itself could not be installed here.
describe("normalizePersonName", () => {
  it("lowercases, strips punctuation, and drops name suffixes", () => {
    expect(normalizePersonName("Bob Smith Jr.")).toBe("bob smith");
    expect(normalizePersonName("Bob Smith")).toBe("bob smith");
    expect(normalizePersonName("  Jane   O'Malley  ")).toBe("jane o'malley");
  });

  it("returns empty string for empty/whitespace input", () => {
    expect(normalizePersonName("")).toBe("");
    expect(normalizePersonName("   ")).toBe("");
  });
});

describe("normalizeEmployerString", () => {
  it("normalizes legal-suffix and ampersand variants to the same string", () => {
    expect(normalizeEmployerString("Marsh & McLennan Cos. Inc.")).toBe(normalizeEmployerString("Marsh McLennan Agency LLC"));
  });

  it("expands known abbreviations token-by-token, not by substring", () => {
    // "ins" only expands as a standalone token -- must not corrupt "Robins".
    expect(normalizeEmployerString("Robins Insurance Group")).toBe("robins insurance");
    expect(normalizeEmployerString("Acme Ins Svcs")).toBe("acme insurance services");
  });
});

describe("normalizeIdentifier", () => {
  it("normalizes email to lowercase", () => {
    expect(normalizeIdentifier("email", "  Jane.Doe@ACME.com ")).toBe("jane.doe@acme.com");
  });

  it("normalizes phone to digits only, stripping a leading US country code", () => {
    expect(normalizeIdentifier("phone", "+1 (415) 555-0100")).toBe("4155550100");
    expect(normalizeIdentifier("phone", "415-555-0100")).toBe("4155550100");
  });

  it("normalizes a linkedin URL to a stable host+path form", () => {
    expect(normalizeIdentifier("linkedin_url", "https://www.linkedin.com/in/janedoe/")).toBe("linkedin.com/in/janedoe");
    expect(normalizeIdentifier("linkedin_url", "linkedin.com/in/janedoe")).toBe("linkedin.com/in/janedoe");
  });
});

describe("computeDedupFingerprint", () => {
  it("combines normalized name with the first employer token", () => {
    expect(computeDedupFingerprint("Jane Doe", "Acme Insurance Group")).toBe("jane doe|acme");
  });

  it("degrades gracefully with no employer", () => {
    expect(computeDedupFingerprint("Jane Doe", null)).toBe("jane doe|");
  });
});
