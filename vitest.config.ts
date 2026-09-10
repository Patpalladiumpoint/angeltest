import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Custody and audit-log tests hit a real Postgres (and, for backup/
    // restore/export, real S3-compatible storage) -- see README "Running
    // tests locally." They are integration tests by nature; no mocking the
    // one guarantee (append-only audit_log) that must hold against the real
    // database engine, not a fake.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
