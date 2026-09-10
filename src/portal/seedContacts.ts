#!/usr/bin/env tsx
// Demo-only: creates one client_contact so the portal can actually be
// signed into locally. Separate from src/db/seed.ts (the Phase 1 core
// seed) since client_contact rows only make sense once clients exist
// (usually after the narrow importer has run) -- this script is meant to
// be run after that, not as part of initial setup.
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { client, brokerage, clientContact } from "@/db/schema";

async function main() {
  const email = process.env.SEED_CLIENT_CONTACT_EMAIL ?? "contact@alliant.example";
  const name = process.env.SEED_CLIENT_CONTACT_NAME ?? "Demo Client Contact";
  const brokerageName = process.env.SEED_CLIENT_CONTACT_BROKERAGE;

  const [existing] = await db.select({ id: clientContact.id }).from(clientContact).where(eq(clientContact.email, email)).limit(1);
  if (existing) {
    console.log(`client_contact already exists: ${email}`);
    return;
  }

  const [clientRow] = brokerageName
    ? await db
        .select({ id: client.id, brokerageName: brokerage.name })
        .from(client)
        .innerJoin(brokerage, eq(brokerage.id, client.brokerageId))
        .where(eq(brokerage.name, brokerageName))
        .limit(1)
    : await db.select({ id: client.id, brokerageName: brokerage.name }).from(client).innerJoin(brokerage, eq(brokerage.id, client.brokerageId)).limit(1);

  if (!clientRow) {
    throw new Error("no client row found -- run the narrow importer first (npm run import:narrow)");
  }

  await db.insert(clientContact).values({ clientId: clientRow.id, email, name });
  console.log(`client_contact created: ${email} -> client ${clientRow.id} (${clientRow.brokerageName})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
