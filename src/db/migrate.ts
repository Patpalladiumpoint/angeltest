#!/usr/bin/env tsx
// Minimal, dependency-free migration runner. Applies the numbered .sql files
// in src/db/migrations in order, tracks what has run in schema_migrations,
// and wraps each file in a transaction so a failure never leaves a
// half-applied migration.
//
// Deliberately not drizzle-kit's own migrator: this project hand-writes SQL
// migrations (see the README section "Why hand-written SQL migrations") so
// the audit_log lockdown and role grants are explicit and reviewable rather
// than generated.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function main() {
  const connectionString = process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("MIGRATIONS_DATABASE_URL (or DATABASE_URL) is not set");
  }

  const sql = postgres(connectionString, { max: 1 });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const applied = new Set(
      (await sql<{ filename: string }[]>`SELECT filename FROM schema_migrations`).map(
        (row) => row.filename,
      ),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ranCount = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const contents = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`Applying ${file}...`);

      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`;
      });

      ranCount += 1;
      console.log(`  done`);
    }

    if (ranCount === 0) {
      console.log("No pending migrations.");
    } else {
      console.log(`Applied ${ranCount} migration(s).`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
