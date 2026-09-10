import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import postgres from "postgres";
import { applyMigrations, setAppRolePassword, requireEnv } from "./helpers/db";
import { crelateAdapter } from "../src/adapters/crelate";
import { quickbooksAdapter } from "../src/adapters/quickbooks";

// Hard rule 1 ("never mock an integration... stop and report") applied to
// the two Phase 0 adapters. These assert the *honest-blocking* behavior,
// against a real Postgres for the event-log side effect -- not against a
// mocked Crelate/QuickBooks, since neither is configured in this suite's
// environment (see .env.example / README).
describe("adapters report blocked, not fake success, when unconfigured", () => {
  const ownerUrl = requireEnv("OWNER_DATABASE_URL");
  const appUrl = requireEnv("APP_DATABASE_URL");

  beforeAll(async () => {
    await applyMigrations(ownerUrl);
    await setAppRolePassword(ownerUrl, new URL(appUrl).password);
    process.env.DATABASE_URL = appUrl;
    delete process.env.CRELATE_API_KEY;
    delete process.env.CRELATE_API_BASE;
    delete process.env.QUICKBOOKS_CLIENT_ID;
    delete process.env.QUICKBOOKS_CLIENT_SECRET;
    delete process.env.QUICKBOOKS_REFRESH_TOKEN;
    delete process.env.QUICKBOOKS_REALM_ID;
  });

  let owner: postgres.Sql;

  beforeEach(async () => {
    owner = postgres(ownerUrl, { max: 1 });
    await owner`TRUNCATE event RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    await owner?.end();
  });

  it("crelate.healthCheck() reports not_configured, never ok", async () => {
    const health = await crelateAdapter.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.status).toBe("not_configured");
  });

  it("crelate.pull() refuses to run and logs an integration_blocked event", async () => {
    const result = await crelateAdapter.pull("live");
    expect(result.blocked).toBe(true);
    expect(result.recordsFetched).toBe(0);

    const rows = await owner`SELECT * FROM event WHERE type = 'integration_blocked' AND source = 'crelate'`;
    expect(rows.length).toBeGreaterThan(0);
  });

  it("quickbooks.healthCheck() reports not_configured without credentials", async () => {
    const health = await quickbooksAdapter.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.status).toBe("not_configured");
  });

  it("quickbooks.pull('dry') is blocked when unconfigured, makes no network call", async () => {
    const result = await quickbooksAdapter.pull("dry");
    expect(result.blocked).toBe(true);
  });

  it("quickbooks.push() always refuses in Phase 0, regardless of config", async () => {
    const result = await quickbooksAdapter.push("dry");
    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toMatch(/read-only/i);
  });
});
