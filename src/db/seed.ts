#!/usr/bin/env tsx
// Dev-only convenience: seeds an admin user (and optionally a couple of
// recruiters) so the app has someone to sign in as -- via the dev-only
// credentials picker (src/auth/config.ts) -- before real SSO is wired to a
// real Workspace/Entra tenant. Never run against a real environment: there
// is no local-password path to protect (spec: "No local passwords"), this
// only seeds the row identity SSO will match against by email on first
// login.
import { db, queryClient } from "./client";
import { users } from "./schema";

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error("Set SEED_ADMIN_EMAIL to seed an initial admin user");
  }

  await db
    .insert(users)
    .values({ email: adminEmail, name: "Admin", role: "admin" })
    .onConflictDoNothing({ target: users.email });
  console.log(`Seeded admin user ${adminEmail} (or it already existed).`);

  // SEED_RECRUITER_EMAILS="a@x.com,b@x.com" -- useful for demoing the
  // collision gate, which needs at least two distinct recruiters.
  const recruiterEmails = (process.env.SEED_RECRUITER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  for (const email of recruiterEmails) {
    await db
      .insert(users)
      .values({ email, name: email.split("@")[0]!, role: "recruiter" })
      .onConflictDoNothing({ target: users.email });
    console.log(`Seeded recruiter ${email} (or it already existed).`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => queryClient.end());
