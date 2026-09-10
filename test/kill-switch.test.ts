import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import postgres from "postgres";
import { applyMigrations, setAppRolePassword, requireEnv } from "./helpers/db";

vi.mock("@/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgresLib = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = postgresLib(process.env.APP_DATABASE_URL!, { max: 1 });
  return { db: drizzle(client, { schema }), queryClient: client };
});

const { isOutboundEnabled, setOutboundEnabled } = await import("@/settings/outbound");

// Spec 3.1: the kill switch is the one button that must reliably halt every
// send. This exercises the real update-plus-audit-row path, not a stub.
describe("outbound kill switch", () => {
  const ownerUrl = requireEnv("OWNER_DATABASE_URL");
  const appUrl = requireEnv("APP_DATABASE_URL");
  let owner: postgres.Sql;
  let adminUserId: string;

  beforeAll(async () => {
    await applyMigrations(ownerUrl);
    await setAppRolePassword(ownerUrl, new URL(appUrl).password);
    owner = postgres(ownerUrl, { max: 1 });

    const [admin] = await owner<{ id: string }[]>`
      INSERT INTO users (email, name, role) VALUES ('admin@test.local', 'Admin', 'admin')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `;
    adminUserId = admin!.id;
  });

  afterAll(async () => {
    await owner?.end();
  });

  beforeEach(async () => {
    await owner`UPDATE system_settings SET outbound_enabled = true WHERE id = 1`;
  });

  it("defaults to enabled", async () => {
    expect(await isOutboundEnabled()).toBe(true);
  });

  it("flips to disabled and records the audit row", async () => {
    await setOutboundEnabled({ enabled: false, actorUserId: adminUserId, reason: "test halt" });

    expect(await isOutboundEnabled()).toBe(false);

    const [entry] = await owner`
      SELECT action, reason, actor_user_id FROM audit_log
      WHERE entity_type = 'system_settings'
      ORDER BY occurred_at DESC LIMIT 1
    `;
    expect(entry?.action).toBe("outbound_disabled");
    expect(entry?.reason).toBe("test halt");
    expect(entry?.actor_user_id).toBe(adminUserId);
  });

  it("flips back to enabled and records a second audit row", async () => {
    await setOutboundEnabled({ enabled: false, actorUserId: adminUserId, reason: "halt" });
    await setOutboundEnabled({ enabled: true, actorUserId: adminUserId, reason: "resume" });

    expect(await isOutboundEnabled()).toBe(true);

    const [entry] = await owner`
      SELECT action FROM audit_log
      WHERE entity_type = 'system_settings'
      ORDER BY occurred_at DESC LIMIT 1
    `;
    expect(entry?.action).toBe("outbound_enabled");
  });
});
