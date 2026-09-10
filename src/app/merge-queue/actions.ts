"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { mergePerson } from "@/identity/merge";
import { rejectMergeCandidate } from "@/identity/resolver";

export async function mergeCandidateAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const candidateId = String(formData.get("candidateId"));
  const survivingPersonId = String(formData.get("survivingPersonId"));
  const absorbedPersonId = String(formData.get("absorbedPersonId"));

  await mergePerson(survivingPersonId, absorbedPersonId, actor, candidateId);
  revalidatePath("/merge-queue");
}

export async function rejectCandidateAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const candidateId = String(formData.get("candidateId"));
  await rejectMergeCandidate(candidateId, actor);
  revalidatePath("/merge-queue");
}
