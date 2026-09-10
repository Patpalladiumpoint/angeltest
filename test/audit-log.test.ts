import { beforeAll, afterAll, describe, it, expect } from "vitest";
import postgres from "postgres";
import { applyMigrations, setAppRolePassword, requireEnv } from "./helpers/db";

// Acceptance criterion 3: "audit_log rejects UPDATE and DELETE at the
// database role level." Runs against a real Postgres -- this guarantee is
// enforced by REVOKE and a trigger inside the database itself, so a mock
// would test nothing.
describe("audit_log append-only enforcement", () => {
  const ownerUrl = requireEnv("OWNER_DATABASE_URL");
  const appUrl = requireEnv("APP_DATABASE_URL");
  const appPassword = new URL(appUrl).password;

  let owner: postgres.Sql;
  let app: postgres.Sql;
  let rowId: string;

  beforeAll(async () => {
    await applyMigrations(ownerUrl);
    await setAppRolePassword(ownerUrl, appPassword);
    owner = postgres(ownerUrl, { max: 1 });
    app = postgres(appUrl, { max: 1 });

    const [row] = await owner<{ id: string }[]>`
      INSERT INTO audit_log (entity_type, entity_id, action)
      VALUES ('test_entity', '1', 'create')
      RETURNING id
    `;
    rowId = row!.id;
  });

  afterAll(async () => {
    await owner?.end();
    await app?.end();
  });

  it("lets the app role INSERT and SELECT", async () => {
    const [inserted] = await app<{ id: string }[]>`
      INSERT INTO audit_log (entity_type, entity_id, action)
      VALUES ('test_entity', '2', 'create')
      RETURNING id
    `;
    expect(inserted?.id).toBeTruthy();

    const rows = await app`SELECT * FROM audit_log WHERE entity_id = '1'`;
    expect(rows).toHaveLength(1);
  });

  it("rejects UPDATE from the app role", async () => {
    await expect(
      app`UPDATE audit_log SET action = 'hacked' WHERE id = ${rowId}`,
    ).rejects.toThrow(/permission denied/i);
  });

  it("rejects DELETE from the app role", async () => {
    await expect(app`DELETE FROM audit_log WHERE id = ${rowId}`).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("rejects UPDATE even from the schema owner, via trigger", async () => {
    await expect(
      owner`UPDATE audit_log SET action = 'hacked' WHERE id = ${rowId}`,
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects DELETE even from the schema owner, via trigger", async () => {
    await expect(owner`DELETE FROM audit_log WHERE id = ${rowId}`).rejects.toThrow(
      /append-only/i,
    );
  });

  it("leaves the row unchanged after every rejected attempt", async () => {
    const [row] = await owner`SELECT action FROM audit_log WHERE id = ${rowId}`;
    expect(row?.action).toBe("create");
  });
});
