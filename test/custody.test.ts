import { beforeAll, afterAll, describe, it, expect } from "vitest";
import postgres from "postgres";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { applyMigrations, requireEnv } from "./helpers/db";
import { documentsClient, backupsClient } from "@/storage/s3";

// Acceptance criteria 1 and 2: a restore from the latest backup provisions a
// working database and passes referential integrity assertions, and the
// on-demand export reproduces matching row counts on reimport. Needs real
// Postgres binaries (pg_dump/pg_restore) and an S3-compatible endpoint
// (MinIO in CI -- see .github/workflows/ci.yml) since both are exactly the
// tools being proven, not things to fake.
describe("backup, restore drill, and export", () => {
  const ownerUrl = requireEnv("OWNER_DATABASE_URL");
  const drillUrl = requireEnv("RESTORE_DRILL_DATABASE_URL");
  let owner: postgres.Sql;

  beforeAll(async () => {
    await ensureBucket(documentsClient, process.env.DOCUMENTS_BUCKET!);
    await ensureBucket(backupsClient, process.env.BACKUPS_BUCKET!);

    await applyMigrations(ownerUrl);
    owner = postgres(ownerUrl, { max: 1 });

    await owner`
      INSERT INTO users (email, name, role) VALUES ('custody-test@test.local', 'Custody Test', 'admin')
      ON CONFLICT (email) DO NOTHING
    `;
  });

  afterAll(async () => {
    await owner?.end();
  });

  it("backs up, restores into the drill database, and passes the drill", async () => {
    const { runBackup } = await import("@/custody/backup");
    const { runRestoreDrill } = await import("@/custody/restoreDrill");

    const backupResult = await runBackup();
    expect(backupResult.sizeBytes).toBeGreaterThan(0);

    const drillResult = await runRestoreDrill();
    expect(drillResult.passed).toBe(true);
    expect(drillResult.backupKey).toBe(backupResult.key);

    for (const counts of Object.values(drillResult.tableCounts)) {
      expect(counts.restored).toBe(counts.source);
    }

    const restored = postgres(drillUrl, { max: 1 });
    try {
      const [row] = await restored`SELECT email FROM users WHERE email = 'custody-test@test.local'`;
      expect(row?.email).toBe("custody-test@test.local");
    } finally {
      await restored.end();
    }
  });

  it("exports every table to JSONL with a manifest that matches source row counts", async () => {
    const { runExport } = await import("@/custody/export");

    const outDir = await mkdtemp(path.join(tmpdir(), "palladium-export-test-"));
    try {
      const manifest = await runExport(outDir);

      const [userCount] = await owner<{ count: string }[]>`SELECT count(*)::text AS count FROM users`;
      expect(manifest.tables.users?.rowCount).toBe(Number(userCount!.count));

      const usersFile = await readFile(path.join(outDir, "users.jsonl"), "utf8");
      const lines = usersFile.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(manifest.tables.users!.rowCount);

      const firstRow = JSON.parse(lines[0]!);
      expect(firstRow).toHaveProperty("email");

      const manifestFile = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"));
      expect(manifestFile.tables.audit_log).toBeDefined();
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

async function ensureBucket(client: import("@aws-sdk/client-s3").S3Client, bucket: string) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}
