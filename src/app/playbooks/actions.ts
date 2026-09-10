"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { createPlaybook, updatePlaybookStatus } from "@/playbooks/queries";

export async function createPlaybookAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");
  const id = await createPlaybook({
    title: String(formData.get("title")),
    category: String(formData.get("category")) as "sop" | "process" | "template" | "client_preference" | "internal_reference",
    body: String(formData.get("body") ?? ""),
    ownerUserId: actor.userId,
  });
  redirect(`/playbooks/${id}`);
}

export async function publishPlaybookAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");
  const id = String(formData.get("id"));
  await updatePlaybookStatus(id, "active");
  revalidatePath(`/playbooks/${id}`);
}
