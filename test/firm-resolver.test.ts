import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import postgres from "postgres";
import { applyMigrations, requireEnv } from "./helpers/db";
import { RESOLVER_FIXTURES } from "./fixtures/messy-employer-strings";

vi.mock("@/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgresLib = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = postgresLib(process.env.OWNER_DATABASE_URL!, { max: 1 });
  return { db: drizzle(client, { schema }), queryClient: client };
});

const { resolveFirm, requiresManualConfirmation, walkAcquisitionChain } = await import(
  "@/firms/resolver"
);
const { seedFirms } = await import("@/db/seedFirms");

// Phase 1 build order: "Build and test the resolver against a fixture set
// of at least 60 messy employer strings including DBAs, former names, and
// acquired entities. Target 95 percent correct resolution or explicit
// needs_manual_review... This phase is where the project succeeds or fails
// quietly. Do not rush it."
describe("firm resolver", () => {
  const ownerUrl = requireEnv("OWNER_DATABASE_URL");
  let owner: postgres.Sql;

  beforeAll(async () => {
    await applyMigrations(ownerUrl);
    owner = postgres(ownerUrl, { max: 1 });
    await seedFirms();
  });

  afterAll(async () => {
    await owner?.end();
  });

  it(`resolves the fixture set at >= 95% accuracy (${RESOLVER_FIXTURES.length} fixtures)`, async () => {
    const failures: string[] = [];
    let pass = 0;

    for (const fixture of RESOLVER_FIXTURES) {
      const result = await resolveFirm(fixture.input);
      const statusOk = result.status === fixture.expectedStatus;
      const methodOk = !fixture.expectedMethod || result.method === fixture.expectedMethod;
      const nameOk = !fixture.expectedCanonicalName || result.matchedName === fixture.expectedCanonicalName;

      if (statusOk && methodOk && nameOk) {
        pass++;
      } else {
        failures.push(
          `"${fixture.input}" -> got {status: ${result.status}, method: ${result.method}, matchedName: ${result.matchedName}} ` +
            `expected {status: ${fixture.expectedStatus}, method: ${fixture.expectedMethod ?? "any"}, name: ${fixture.expectedCanonicalName ?? "any"}}`,
        );
      }
    }

    const accuracy = pass / RESOLVER_FIXTURES.length;
    if (failures.length > 0) {
      console.log(`Resolver fixture failures:\n${failures.join("\n")}`);
    }
    expect(accuracy).toBeGreaterThanOrEqual(0.95);
  });

  it("AC9: 'Woodruff Sawyer' resolves exactly and applies the Gallagher acquisition rule", async () => {
    const resolution = await resolveFirm("Woodruff Sawyer");
    expect(resolution.status).toBe("resolved");
    expect(resolution.method).toBe("exact");
    expect(resolution.matchedName).toBe("Woodruff Sawyer");

    const walk = await walkAcquisitionChain(resolution.firmId!, new Date("2026-09-10"));
    expect(walk.chain).toHaveLength(1);
    expect(walk.chain[0]?.eventType).toBe("acquired_by");
    // Gallagher is itself a Top 100 firm, so per OQ 2 the candidate stays
    // eligible even though the transition window (announced_at through
    // effective_at + 12 months) has long since closed by this date.
    expect(walk.eligibilityHint).toBe("eligible");

    const [effectiveFirm] = await owner`SELECT canonical_name FROM firms WHERE id = ${walk.effectiveFirmId}`;
    expect(effectiveFirm?.canonical_name).toBe("Arthur J. Gallagher & Co.");
  });

  it("AC10: 'Accession Risk Management Group, dba Risk Strategies Co.' resolves through the alias path", async () => {
    const resolution = await resolveFirm("Accession Risk Management Group, dba Risk Strategies Co.");
    expect(resolution.status).toBe("resolved");
    expect(resolution.method).toBe("alias");
    expect(resolution.matchedName).toBe("Risk Strategies");
    expect(resolution.confidence).toBe(0.95);

    const [firm] = await owner`SELECT canonical_name FROM firms WHERE id = ${resolution.firmId}`;
    expect(firm?.canonical_name).toBe("Accession Risk Management Group");
  });

  it("AC11: a fuzzy match still requires manual confirmation before it can reach outreach", async () => {
    const resolution = await resolveFirm("Christensen Group Insuranc");
    expect(resolution.status).toBe("resolved");
    expect(resolution.method).toBe("fuzzy");
    expect(resolution.confidence).toBeGreaterThan(0.85);
    expect(resolution.confidence).toBeLessThan(0.95);

    // Spec 8.1 step 1: "Below 0.95 confidence -> manual review, hard stop."
    // A successful fuzzy resolution is not the same thing as being cleared
    // for outreach.
    expect(requiresManualConfirmation(resolution)).toBe(true);
  });

  it("exact and alias matches never require manual confirmation", async () => {
    const exact = await resolveFirm("Arthur J. Gallagher & Co.");
    expect(requiresManualConfirmation(exact)).toBe(false);

    const alias = await resolveFirm("Risk Strategies");
    expect(requiresManualConfirmation(alias)).toBe(false);
  });

  it("needs_manual_review always requires manual confirmation", async () => {
    const noMatch = await resolveFirm("Some Totally Unrelated Company LLC");
    expect(noMatch.status).toBe("needs_manual_review");
    expect(requiresManualConfirmation(noMatch)).toBe(true);
  });

  it("seedFirms() is idempotent -- re-running does not duplicate rows", async () => {
    const [before] = await owner<{ count: string }[]>`SELECT count(*)::text AS count FROM firms`;
    await seedFirms();
    const [after] = await owner<{ count: string }[]>`SELECT count(*)::text AS count FROM firms`;
    expect(after?.count).toBe(before?.count);
  });
});
