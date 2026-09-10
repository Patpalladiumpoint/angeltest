#!/usr/bin/env tsx
// Nightly logical backup (spec 3.7): pg_dump to a custom-format archive,
// uploaded to the backups bucket, which must live in a different
// account/region than the primary DB (see .env.example). Run this from the
// scheduler process on a nightly cron, not from the web process.
//
// 35-day retention is enforced primarily by a bucket lifecycle rule on
// BACKUPS_BUCKET (set once at infrastructure provisioning time -- see
// README "Backups and restore"), because that holds even if this script
// never runs again. deletePastRetention() below is a second, redundant
// enforcement for S3-compatible providers with no lifecycle support.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { backupsBucket, backupsClient, putObject, listObjectsWithMetadata } from "@/storage/s3";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

const execFileAsync = promisify(execFile);

const RETENTION_DAYS = 35;
const BACKUP_PREFIX = "postgres/";

export async function runBackup(): Promise<{ key: string; checksumSha256: string; sizeBytes: number }> {
  const connectionString = process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("MIGRATIONS_DATABASE_URL (or DATABASE_URL) is not set");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tmpDir = await mkdtemp(path.join(tmpdir(), "palladium-backup-"));
  const dumpPath = path.join(tmpDir, `${timestamp}.dump`);

  try {
    await execFileAsync("pg_dump", ["--format=custom", "--file", dumpPath, connectionString]);

    const body = await readFile(dumpPath);
    const key = `${BACKUP_PREFIX}${timestamp}.dump`;

    const { checksumSha256 } = await putObject({
      client: backupsClient,
      bucket: backupsBucket(),
      key,
      body,
      contentType: "application/octet-stream",
    });

    console.log(`Backup uploaded: ${key} (${body.length} bytes, sha256 ${checksumSha256})`);

    await deletePastRetention();
    await recordLastBackup(connectionString);

    return { key, checksumSha256, sizeBytes: body.length };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// Feeds the Data health report's "Last successful backup" line (spec
// section 9). Written to system_settings, not audit_log -- this is
// operational status, not a record of a business state transition.
async function recordLastBackup(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    await sql`UPDATE system_settings SET last_backup_at = now() WHERE id = 1`;
  } finally {
    await sql.end();
  }
}

async function deletePastRetention(): Promise<void> {
  const objects = await listObjectsWithMetadata({
    client: backupsClient,
    bucket: backupsBucket(),
    prefix: BACKUP_PREFIX,
  });

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  for (const obj of objects) {
    if (obj.lastModified && obj.lastModified.getTime() < cutoff) {
      await backupsClient.send(new DeleteObjectCommand({ Bucket: backupsBucket(), Key: obj.key }));
      console.log(`Pruned backup past ${RETENTION_DAYS}-day retention: ${obj.key}`);
    }
  }
}

if (require.main === module) {
  runBackup().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
