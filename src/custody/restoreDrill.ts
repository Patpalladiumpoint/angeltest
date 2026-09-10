#!/usr/bin/env tsx
// The restore drill (section 6: "tested backup and restore... untested
// restores do not count"). A backup nobody has restored is not a backup.
//
// Steps:
//   1. Find the most recent object in the backups bucket.
//   2. Download it and pg_restore it into a disposable scratch database
//      (RESTORE_DRILL_DATABASE_URL) -- never dev or prod.
//   3. Assert every table's row count in the restored DB matches the source
//      DB (MIGRATIONS_DATABASE_URL) at drill time.
//   4. Assert no foreign key in the restored DB points at a row that does
//      not exist -- explicit, not just "pg_restore didn't error."
//   5. Record the outcome as an event (see backup.ts's comment on why
//      events, not a settings table).
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import postgres from "postgres";
import { db } from "@/db/client";
import { writeEvent } from "@/events/writer";
import { backupsBucket, getObjectBuffer, listObjectsWithMetadata } from "@/storage/s3";

const execFileAsync = promisify(execFile);

interface DrillResult {
  backupKey: string;
  tableCounts: Record<string, { source: number; restored: number }>;
  orphanFindings: string[];
  passed: boolean;
}

export async function runRestoreDrill(): Promise<DrillResult> {
  const sourceUrl = process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL;
  const drillUrl = process.env.RESTORE_DRILL_DATABASE_URL;
  if (!sourceUrl) throw new Error("MIGRATIONS_DATABASE_URL (or DATABASE_URL) is not set");
  if (!drillUrl) throw new Error("RESTORE_DRILL_DATABASE_URL is not set");
  if (drillUrl === sourceUrl) {
    throw new Error("RESTORE_DRILL_DATABASE_URL must not be the same database as the source");
  }

  const objects = await listObjectsWithMetadata({ bucket: backupsBucket(), prefix: "postgres/" });
  if (objects.length === 0) {
    throw new Error("No backups found in the backups bucket -- run backup:run first");
  }
  const latest = objects.reduce((a, b) => ((a.lastModified?.getTime() ?? 0) >= (b.lastModified?.getTime() ?? 0) ? a : b));

  const tmpDir = await mkdtemp(path.join(tmpdir(), "palladium-restore-drill-"));
  const dumpPath = path.join(tmpDir, "latest.dump");

  try {
    const body = await getObjectBuffer({ bucket: backupsBucket(), key: latest.key });
    await writeFile(dumpPath, body);

    await recreateDrillDatabase(drillUrl);
    await execFileAsync("pg_restore", ["--no-owner", "--dbname", drillUrl, dumpPath]);

    const tables = await listUserTables(sourceUrl);
    const tableCounts: DrillResult["tableCounts"] = {};
    for (const table of tables) {
      const [sourceCount, restoredCount] = await Promise.all([countRows(sourceUrl, table), countRows(drillUrl, table)]);
      tableCounts[table] = { source: sourceCount, restored: restoredCount };
    }

    const mismatches = Object.entries(tableCounts).filter(([, c]) => c.source !== c.restored);
    const orphanFindings = await findOrphanedForeignKeys(drillUrl);

    const passed = mismatches.length === 0 && orphanFindings.length === 0;
    await writeEvent(db, {
      type: "restore_drill.completed",
      source: "system",
      entityType: "system",
      entityId: "restore_drill",
      payload: { backupKey: latest.key, passed, mismatches, orphanFindings },
      occurredAt: new Date(),
    });

    if (!passed) {
      const details = [
        ...mismatches.map(([t, c]) => `row count mismatch on ${t}: source=${c.source} restored=${c.restored}`),
        ...orphanFindings,
      ];
      throw new Error(`Restore drill failed:\n${details.join("\n")}`);
    }

    console.log(`Restore drill passed against backup ${latest.key}`);
    console.table(tableCounts);

    return { backupKey: latest.key, tableCounts, orphanFindings, passed };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function recreateDrillDatabase(drillUrl: string): Promise<void> {
  const url = new URL(drillUrl);
  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName) throw new Error("RESTORE_DRILL_DATABASE_URL must include a database name");

  const maintenanceUrl = new URL(drillUrl);
  maintenanceUrl.pathname = "/postgres";
  const maintenance = postgres(maintenanceUrl.toString(), { max: 1 });

  try {
    await maintenance.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
    );
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    await maintenance.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await maintenance.end();
  }
}

async function listUserTables(connectionString: string): Promise<string[]> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    const rows = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
      ORDER BY tablename
    `;
    return rows.map((r) => r.tablename);
  } finally {
    await sql.end();
  }
}

async function countRows(connectionString: string, table: string): Promise<number> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    const [row] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM ${sql(table)}`;
    return Number(row?.count ?? 0);
  } finally {
    await sql.end();
  }
}

// Note: this information_schema join pairs key_column_usage and
// constraint_column_usage positionally, which is only reliable for
// single-column foreign keys. Every FK in this schema is single-column; a
// composite FK would need pg_constraint's conkey/confkey arrays instead.
async function findOrphanedForeignKeys(connectionString: string): Promise<string[]> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    const constraints = await sql<
      { constraint_name: string; table_name: string; column_name: string; foreign_table_name: string; foreign_column_name: string }[]
    >`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `;

    const findings: string[] = [];
    for (const c of constraints) {
      const [row] = await sql.unsafe<{ orphans: string }[]>(
        `SELECT count(*)::text AS orphans
         FROM ${quoteIdent(c.table_name)} child
         WHERE child.${quoteIdent(c.column_name)} IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM ${quoteIdent(c.foreign_table_name)} parent
             WHERE parent.${quoteIdent(c.foreign_column_name)} = child.${quoteIdent(c.column_name)}
           )`,
      );
      const orphanCount = Number(row?.orphans ?? 0);
      if (orphanCount > 0) {
        findings.push(
          `${orphanCount} orphaned row(s) in ${c.table_name}.${c.column_name} -> ${c.foreign_table_name}.${c.foreign_column_name} (${c.constraint_name})`,
        );
      }
    }
    return findings;
  } finally {
    await sql.end();
  }
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

if (require.main === module) {
  runRestoreDrill().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
