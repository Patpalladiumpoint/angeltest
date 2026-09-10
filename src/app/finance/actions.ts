"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { createInvoice, recordPayment, markCommissionEligible, markCommissionPaid } from "@/finance/queries";

export async function createInvoiceAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");
  await createInvoice(
    {
      placementId: String(formData.get("placementId")),
      clientId: String(formData.get("clientId")),
      invoiceNumber: String(formData.get("invoiceNumber")),
      amount: Number(formData.get("amount")),
      dueAt: new Date(String(formData.get("dueAt"))),
    },
    actor,
  );
  revalidatePath("/finance");
}

export async function recordPaymentAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");
  await recordPayment({ invoiceId: String(formData.get("invoiceId")), amount: Number(formData.get("amount")) }, actor);
  revalidatePath("/finance");
}

export async function markCommissionEligibleAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");
  await markCommissionEligible(String(formData.get("commissionId")), actor);
  revalidatePath("/finance");
}

export async function markCommissionPaidAction(formData: FormData): Promise<void> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");
  await markCommissionPaid(String(formData.get("commissionId")), actor);
  revalidatePath("/finance");
}
