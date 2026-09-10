import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
} satisfies Config;
