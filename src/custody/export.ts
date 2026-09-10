#!/usr/bin/env tsx
// On-demand full export (section 4.2: "CSV export of every entity... the
// firm must not be locked into its own system either"). Every table to
// JSONL plus a manifest, one command. Table-agnostic (information_schema),
// so it never needs updating when a table is added.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

export async function runExport(outDir: string): Promise<{ table: string; rowCount: number }[]> {
  const connectionString = process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("MIGRATIONS_DATABASE_URL (or DATABASE_URL) is not set");

  const sql = postgres(connectionString, { max: 1 });
  const manifest: { table: string; rowCount: number }[] = [];

  try {
    await mkdir(outDir, { recursive: true });

    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
      ORDER BY tablename
    `;

    for (const { tablename } of tables) {
      const rows = await sql.unsafe<Record<string, unknown>[]>(`SELECT row_to_json(t) AS row FROM ${quoteIdent(tablename)} t`);
      const lines = rows.map((r) => JSON.stringify((r as unknown as { row: unknown }).row ?? r));
      await writeFile(path.join(outDir, `${tablename}.jsonl`), lines.join("\n") + (lines.length ? "\n" : ""));
      manifest.push({ table: tablename, rowCount: rows.length });
      console.log(`${tablename}: ${rows.length} rows`);
    }

    await writeFile(
      path.join(outDir, "manifest.json"),
      JSON.stringify({ exportedAt: new Date().toISOString(), tables: manifest }, null, 2),
    );

    return manifest;
  } finally {
    await sql.end();
  }
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

if (require.main === module) {
  const outDir = process.argv[2] ?? path.join(process.cwd(), "export", new Date().toISOString().replace(/[:.]/g, "-"));
  runExport(outDir)
    .then(() => {
      console.log(`Export written to ${outDir}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
