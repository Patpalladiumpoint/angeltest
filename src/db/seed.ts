#!/usr/bin/env tsx
// Dev/CI seed: one organization plus one user per SEED_*_EMAIL env var.
// Idempotent (ON CONFLICT DO NOTHING on email) so it's safe to run against
// an already-seeded database.
import { db } from "@/db/client";
import { organization, appUser } from "@/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const orgName = process.env.SEED_ORGANIZATION_NAME ?? "Palladium Point";
  const [org] = await db.select().from(organization).limit(1);
  const organizationId = org?.id ?? (await db.insert(organization).values({ name: orgName }).returning())[0]!.id;
  console.log(`organization: ${orgName} (${organizationId})`);

  const execEmail = process.env.SEED_EXEC_EMAIL;
  const opsEmails = (process.env.SEED_OPS_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  const recruiterEmails = (process.env.SEED_RECRUITER_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);

  const users: { email: string; name: string; role: "recruiter" | "ops" | "exec" }[] = [];
  if (execEmail) users.push({ email: execEmail, name: execEmail.split("@")[0]!, role: "exec" });
  for (const email of opsEmails) users.push({ email, name: email.split("@")[0]!, role: "ops" });
  for (const email of recruiterEmails) users.push({ email, name: email.split("@")[0]!, role: "recruiter" });

  if (users.length === 0) {
    console.log(
      "No SEED_EXEC_EMAIL/SEED_OPS_EMAILS/SEED_RECRUITER_EMAILS set -- organization created with no users. " +
        "Set at least SEED_EXEC_EMAIL to seed a usable dev account.",
    );
  }

  for (const u of users) {
    const [existing] = await db.select().from(appUser).where(eq(appUser.email, u.email)).limit(1);
    if (existing) {
      console.log(`user exists: ${u.email} (${existing.role})`);
      continue;
    }
    const [created] = await db.insert(appUser).values({ organizationId, ...u }).returning();
    console.log(`user created: ${created!.email} (${created!.role})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
