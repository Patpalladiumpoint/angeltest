import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import { applyMigrations, setAppRolePassword, requireEnv } from "./helpers/db";
import {
  engagementsWithNoOwner,
  placementsWithNoInvoice,
  placementsWithNoFee,
  invoicesWithNoPlacement,
  duplicateCandidates,
} from "../src/db/reconciliation";

// Spec section 7, Phase 0's own checklist, run against real rows in a real
// Postgres -- these are the findings the reconciliation dashboard reports.
describe("reconciliation queries", () => {
  const ownerUrl = requireEnv("OWNER_DATABASE_URL");
  const appUrl = requireEnv("APP_DATABASE_URL");

  let owner: postgres.Sql;

  beforeAll(async () => {
    await applyMigrations(ownerUrl);
    await setAppRolePassword(ownerUrl, new URL(appUrl).password);
    process.env.DATABASE_URL = appUrl;
  });

  beforeEach(async () => {
    owner = postgres(ownerUrl, { max: 1 });
    await owner`TRUNCATE client, job, candidate, engagement, placement, invoice, payment RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    await owner?.end();
  });

  it("finds an engagement with no owner", async () => {
    const db = drizzle(owner, { schema });
    const [c] = await db.insert(schema.client).values({ name: "Acme" }).returning();
    const [j] = await db.insert(schema.job).values({ clientId: c!.id, title: "VP Sales" }).returning();
    const [cand] = await db
      .insert(schema.candidate)
      .values({ crelateId: "c1", name: "Jamie Lee" })
      .returning();
    await db.insert(schema.engagement).values({ candidateId: cand!.id, jobId: j!.id });

    const rows = await engagementsWithNoOwner();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.candidateName).toBe("Jamie Lee");
  });

  it("finds a placement with no invoice and no fee", async () => {
    const db = drizzle(owner, { schema });
    const [c] = await db.insert(schema.client).values({ name: "Acme" }).returning();
    const [j] = await db.insert(schema.job).values({ clientId: c!.id, title: "VP Sales" }).returning();
    const [cand] = await db.insert(schema.candidate).values({ crelateId: "c1", name: "Jamie Lee" }).returning();
    const [eng] = await db
      .insert(schema.engagement)
      .values({ candidateId: cand!.id, jobId: j!.id })
      .returning();
    await db.insert(schema.placement).values({ engagementId: eng!.id, status: "confirmed" });

    expect(await placementsWithNoInvoice()).toHaveLength(1);
    expect(await placementsWithNoFee()).toHaveLength(1);
  });

  it("finds an invoice with no placement", async () => {
    const db = drizzle(owner, { schema });
    await db.insert(schema.invoice).values({ quickbooksId: "qb-1", amount: "1000.00", status: "open" });

    const rows = await invoicesWithNoPlacement();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.quickbooksId).toBe("qb-1");
  });

  it("finds duplicate candidates by normalized name + employer", async () => {
    const db = drizzle(owner, { schema });
    await db.insert(schema.candidate).values([
      { crelateId: "dup-1", name: "Pat Delgado", currentEmployer: "Acme Co" },
      { crelateId: "dup-2", name: "  pat delgado ", currentEmployer: "ACME CO" },
      { crelateId: "unique-1", name: "Someone Else", currentEmployer: "Other Co" },
    ]);

    const groups = await duplicateCandidates();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.candidate_count).toBe(2);
  });
});
