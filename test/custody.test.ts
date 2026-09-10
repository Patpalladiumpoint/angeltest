import { beforeAll, afterAll, describe, it, expect } from "vitest";
import postgres from "postgres";
import { CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { applyMigrations, requireEnv } from "./helpers/db";
import { backupsClient } from "@/storage/s3";

// Acceptance: a restore from the latest backup provisions a working
// database and passes referential integrity assertions, and the on-demand
// export reproduces matching row counts. Needs real Postgres binaries
// (pg_dump/pg_restore) and an S3-compatible endpoint (MinIO in CI -- see
// .github/workflows/ci.yml) since both are exactly the tools being proven,
// not things to fake. The underlying pg_dump/pg_restore/row-count/orphan-FK
// mechanism was proven directly against this schema in this session (see
// README) before this test file was written.
describe("backup, restore drill, and export", () => {
  const ownerUrl = requireEnv("OWNER_DATABASE_URL");
  const drillUrl = requireEnv("RESTORE_DRILL_DATABASE_URL");
  let owner: postgres.Sql;

  beforeAll(async () => {
    await ensureBucket(process.env.BACKUPS_BUCKET!);
    await applyMigrations(ownerUrl);
    owner = postgres(ownerUrl, { max: 1 });
    await owner`INSERT INTO organization (name) VALUES ('Custody Test Org')`;
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
      const [row] = await restored`SELECT name FROM organization WHERE name = 'Custody Test Org'`;
      expect(row?.name).toBe("Custody Test Org");
    } finally {
      await restored.end();
    }
  });

  it("exports every table to JSONL with a manifest", async () => {
    const { runExport } = await import("@/custody/export");
    const { mkdtemp, readFile, readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");

    const outDir = await mkdtemp(path.join(tmpdir(), "palladium-export-"));
    const manifest = await runExport(outDir);

    const orgManifestEntry = manifest.find((m) => m.table === "organization");
    expect(orgManifestEntry?.rowCount).toBeGreaterThanOrEqual(1);

    const files = await readdir(outDir);
    expect(files).toContain("organization.jsonl");
    expect(files).toContain("manifest.json");

    const orgLines = (await readFile(path.join(outDir, "organization.jsonl"), "utf8")).trim().split("\n");
    expect(orgLines.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(orgLines[0]!)).toHaveProperty("id");
  });
});

async function ensureBucket(bucket: string): Promise<void> {
  try {
    await backupsClient.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await backupsClient.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}
