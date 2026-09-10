import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = path.join(__dirname, "../../src/db/migrations");

// Test-only migration apply: same files the real migrator uses, applied
// directly against whatever owner connection the test suite is given. Kept
// separate from src/db/migrate.ts (which tracks state in schema_migrations
// for a long-lived database) because tests want a from-scratch, idempotent
// apply against a throwaway database every run.
export async function applyMigrations(ownerUrl: string): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1 });
  try {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      await sql.unsafe(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    }
  } finally {
    await sql.end();
  }
}

// The migration only creates the palladium_app role; its password is set
// out of band in real deploys. Tests do that step here.
export async function setAppRolePassword(ownerUrl: string, password: string): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1 });
  try {
    await sql.unsafe(`ALTER ROLE palladium_app PASSWORD '${password}' LOGIN`);
  } finally {
    await sql.end();
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Integration tests need a real Postgres -- see README "Running tests locally".`);
  }
  return value;
}
