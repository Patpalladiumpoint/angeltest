#!/usr/bin/env tsx
// Dev-only convenience: creates one admin user so the app has someone to
// sign in as before real SSO is wired to a real Workspace/Entra tenant.
// Never run against a real environment -- there is no local-password path
// to protect (spec: "No local passwords"), this only seeds the row identity
// SSO will match against by email on first login.
import { db, queryClient } from "./client";
import { users } from "./schema";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  if (!email) {
    throw new Error("Set SEED_ADMIN_EMAIL to seed an initial admin user");
  }

  await db
    .insert(users)
    .values({ email, name: "Admin", role: "admin" })
    .onConflictDoNothing({ target: users.email });

  console.log(`Seeded admin user ${email} (or it already existed).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => queryClient.end());
