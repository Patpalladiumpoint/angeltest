"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { markInterviewCompleted, recordInterviewFeedback, scheduleInterview } from "@/interviews/queries";

export async function markCompletedAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");
  await markInterviewCompleted(String(formData.get("interviewId")), actor);
  revalidatePath("/interviews");
  revalidatePath("/dct");
  revalidatePath("/tasks");
}

export async function recordFeedbackAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");
  const side = String(formData.get("side")) as "candidate" | "client";
  await recordInterviewFeedback(String(formData.get("interviewId")), side, String(formData.get("feedback")), actor);
  revalidatePath("/interviews");
}

export async function scheduleInterviewAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");
  await scheduleInterview(
    {
      engagementId: String(formData.get("engagementId")),
      roundNumber: Number(formData.get("roundNumber") ?? 1),
      interviewType: (String(formData.get("interviewType") ?? "sendout")) as "sendout" | "follow_up" | "final" | "debrief" | "other",
      scheduledAt: new Date(String(formData.get("scheduledAt"))),
      meetingUrl: String(formData.get("meetingUrl") ?? "") || undefined,
    },
    actor,
  );
  revalidatePath("/interviews");
}
