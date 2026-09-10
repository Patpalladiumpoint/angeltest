"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { clientContact } from "@/db/schema";
import { writeAuditLog } from "@/audit/log";

export async function addClientContactAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const clientId = String(formData.get("clientId"));
  const name = String(formData.get("name"));
  const email = String(formData.get("email")).trim().toLowerCase();

  const [created] = await db.insert(clientContact).values({ clientId, name, email }).returning({ id: clientContact.id });

  await writeAuditLog(db, {
    actorUserId: actor.userId,
    action: "create_client_contact",
    entityType: "client_contact",
    entityId: created!.id,
    before: null,
    after: { clientId, name, email },
  });

  revalidatePath(`/clients/${clientId}`);
}
