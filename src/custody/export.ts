#!/usr/bin/env tsx
// On-demand full export (spec 3.7): "every candidate, firm, engagement,
// search, activity, and document as a documented archive (JSONL plus
// original files). One command, no engineer required. This is the exit path
// from this system."
//
// Phase 0 scope: every table that exists today (users, system_settings,
// feature_flags, audit_log) plus the manifest and document-fetch machinery
// later phases will reuse unchanged as more tables land. Each table's rows
// go to <out>/<table>.jsonl, one JSON object per line, in primary-key order
// so a diff between two exports is meaningful. Documents (once the
// `documents` table exists) will be fetched into <out>/documents/<id>/ and
// checksummed against their storage_key checksum -- the loop is already
// here, gated on the table's presence, so wiring it up later is additive.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { getObjectBuffer, documentsClient, documentsBucket } from "@/storage/s3";

interface ExportManifest {
  exportedAt: string;
  tables: Record<string, { rowCount: number; file: string }>;
  documents: { count: number; totalBytes: number };
}

export async function runExport(outDir: string): Promise<ExportManifest> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  await mkdir(outDir, { recursive: true });

  const sql = postgres(connectionString, { max: 1 });
  const manifest: ExportManifest = {
    exportedAt: new Date().toISOString(),
    tables: {},
    documents: { count: 0, totalBytes: 0 },
  };

  try {
    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
      ORDER BY tablename
    `;

    for (const { tablename } of tables) {
      const pk = await primaryKeyColumn(sql, tablename);
      const rows = pk
        ? await sql.unsafe(`SELECT * FROM ${quoteIdent(tablename)} ORDER BY ${quoteIdent(pk)}`)
        : await sql.unsafe(`SELECT * FROM ${quoteIdent(tablename)}`);

      const file = `${tablename}.jsonl`;
      const lines = rows.map((row) => JSON.stringify(row)).join("\n");
      await writeFile(path.join(outDir, file), lines.length > 0 ? lines + "\n" : "");

      manifest.tables[tablename] = { rowCount: rows.length, file };
    }

    // Documents export: only runs once a `documents` table exists (a later
    // phase). Written now so it never gets forgotten when that table lands.
    if (tables.some((t) => t.tablename === "documents")) {
      const documentsDir = path.join(outDir, "documents");
      await mkdir(documentsDir, { recursive: true });

      const docs = await sql<{ id: string; storage_key: string; filename: string }[]>`
        SELECT id, storage_key, filename FROM documents
      `;

      for (const doc of docs) {
        const buffer = await getObjectBuffer({
          client: documentsClient,
          bucket: documentsBucket(),
          key: doc.storage_key,
        });
        await writeFile(path.join(documentsDir, `${doc.id}-${doc.filename}`), buffer);
        manifest.documents.count += 1;
        manifest.documents.totalBytes += buffer.length;
      }
    }

    await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    console.log(`Export written to ${outDir}`);
    console.table(
      Object.fromEntries(Object.entries(manifest.tables).map(([t, v]) => [t, v.rowCount])),
    );

    return manifest;
  } finally {
    await sql.end();
  }
}

async function primaryKeyColumn(sql: postgres.Sql, table: string): Promise<string | null> {
  const [row] = await sql<{ column_name: string }[]>`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = ${table}
    LIMIT 1
  `;
  return row?.column_name ?? null;
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

if (require.main === module) {
  const outDir = process.argv[2] ?? path.join(process.cwd(), "tmp-export", new Date().toISOString().replace(/[:.]/g, "-"));
  runExport(outDir).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
