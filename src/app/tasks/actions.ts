"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { completeTask } from "@/tasks/queries";

export async function completeTaskAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const taskId = String(formData.get("taskId"));
  await completeTask(taskId, actor);
  revalidatePath("/tasks");
  revalidatePath("/dct");
}
