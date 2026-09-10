#!/usr/bin/env tsx
// Nightly logical backup (section 6: "Nightly automated backup with a
// documented, tested restore"). pg_dump to a custom-format archive,
// uploaded to the backups bucket, which must live in a different
// account/region than the primary DB (see .env.example).
//
// Outcome is recorded as an event (type='backup.completed', source=
// 'system') rather than a dedicated system_settings row -- v3.0's schema
// doesn't have a settings singleton table, and the event spine (spec 3.3)
// is already the place operational facts land; the data quality
// report/dashboard reads the latest such event for "last successful
// backup."
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { db } from "@/db/client";
import { writeEvent } from "@/events/writer";
import { backupsBucket, putObject, listObjectsWithMetadata, deleteObject } from "@/storage/s3";

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
      bucket: backupsBucket(),
      key,
      body,
      contentType: "application/octet-stream",
    });

    console.log(`Backup uploaded: ${key} (${body.length} bytes, sha256 ${checksumSha256})`);

    await deletePastRetention();
    await writeEvent(db, {
      type: "backup.completed",
      source: "system",
      entityType: "system",
      entityId: "backup",
      payload: { key, checksumSha256, sizeBytes: body.length },
      occurredAt: new Date(),
    });

    return { key, checksumSha256, sizeBytes: body.length };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function deletePastRetention(): Promise<void> {
  const objects = await listObjectsWithMetadata({ bucket: backupsBucket(), prefix: BACKUP_PREFIX });
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  for (const obj of objects) {
    if (obj.lastModified && obj.lastModified.getTime() < cutoff) {
      await deleteObject({ bucket: backupsBucket(), key: obj.key });
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
