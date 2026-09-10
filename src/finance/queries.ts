// Financial Operating System (section 11), internal only. Every read goes
// through invoices_for_actor()/payments_for_actor()/commissions_for_actor()
// (migrations/0013) -- never a direct SELECT against invoice/payment/
// commission, which the database itself refuses (table-level SELECT is
// revoked). Writes go through withActor() + role checks below, mirroring
// how every other mutation in this app is gated -- see docs/security.md
// for the full read-vs-write enforcement boundary this module documents.
import { sql, eq } from "drizzle-orm";
import { db, withActor, type Actor, type DbTx } from "@/db/client";
import { invoice, payment, commission } from "@/db/schema";
import { writeAuditLog } from "@/audit/log";
import { writeEvent } from "@/events/writer";

export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  clientName: string;
  personName: string;
  amount: number;
  issuedAt: Date;
  dueAt: Date;
  paidAt: Date | null;
  status: string;
};

export async function listInvoices(actor: Actor): Promise<InvoiceRow[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      invoice_number: string;
      client_name: string;
      person_name: string;
      amount: number;
      issued_at: Date;
      due_at: Date;
      paid_at: Date | null;
      status: string;
    }>(sql`
      SELECT i.id, i.invoice_number, b.name AS client_name, p.primary_name AS person_name,
             i.amount, i.issued_at, i.due_at, i.paid_at, i.status::text
      FROM invoices_for_actor() i
      JOIN client c ON c.id = i.client_id
      JOIN brokerage b ON b.id = c.brokerage_id
      JOIN placement pl ON pl.id = i.placement_id
      JOIN engagement e ON e.id = pl.engagement_id
      JOIN person p ON p.id = e.person_id
      ORDER BY i.due_at ASC
    `);
    return rows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      clientName: r.client_name,
      personName: r.person_name,
      amount: Number(r.amount),
      issuedAt: r.issued_at,
      dueAt: r.due_at,
      paidAt: r.paid_at,
      status: r.status,
    }));
  });
}

export type ArSummary = {
  totalInvoiced: number;
  totalCollected: number;
  outstanding: number;
  overdue: number;
  upcoming: number;
  agingBuckets: { label: string; amount: number }[];
};

export async function getArSummary(actor: Actor): Promise<ArSummary> {
  const invoices = await listInvoices(actor);
  const now = new Date();
  let totalInvoiced = 0;
  let totalCollected = 0;
  let overdue = 0;
  let upcoming = 0;
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };

  for (const inv of invoices) {
    totalInvoiced += inv.amount;
    if (inv.status === "paid") {
      totalCollected += inv.amount;
      continue;
    }
    if (inv.dueAt < now) {
      overdue += inv.amount;
      const daysPast = Math.floor((now.getTime() - inv.dueAt.getTime()) / (1000 * 60 * 60 * 24));
      if (daysPast <= 30) buckets["0-30"] += inv.amount;
      else if (daysPast <= 60) buckets["31-60"] += inv.amount;
      else if (daysPast <= 90) buckets["61-90"] += inv.amount;
      else buckets["90+"] += inv.amount;
    } else {
      upcoming += inv.amount;
    }
  }

  return {
    totalInvoiced,
    totalCollected,
    outstanding: totalInvoiced - totalCollected,
    overdue,
    upcoming,
    agingBuckets: Object.entries(buckets).map(([label, amount]) => ({ label, amount })),
  };
}

export type CommissionRow = {
  id: string;
  recruiterName: string;
  personName: string;
  placementFee: number;
  commissionPercent: number;
  commissionAmount: number;
  eligibilityStatus: string;
  paymentStatus: string;
};

export async function listCommissions(actor: Actor): Promise<CommissionRow[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      recruiter_name: string;
      person_name: string;
      placement_fee: number;
      commission_percent: number;
      commission_amount: number;
      eligibility_status: string;
      payment_status: string;
    }>(sql`
      SELECT cm.id, u.name AS recruiter_name, p.primary_name AS person_name,
             cm.placement_fee, cm.commission_percent, cm.commission_amount,
             cm.eligibility_status::text, cm.payment_status::text
      FROM commissions_for_actor() cm
      JOIN app_user u ON u.id = cm.recruiter_user_id
      JOIN placement pl ON pl.id = cm.placement_id
      JOIN engagement e ON e.id = pl.engagement_id
      JOIN person p ON p.id = e.person_id
      ORDER BY cm.created_at DESC
    `);
    return rows.map((r) => ({
      id: r.id,
      recruiterName: r.recruiter_name,
      personName: r.person_name,
      placementFee: Number(r.placement_fee),
      commissionPercent: Number(r.commission_percent),
      commissionAmount: Number(r.commission_amount),
      eligibilityStatus: r.eligibility_status,
      paymentStatus: r.payment_status,
    }));
  });
}

export type CommissionDashboard = { accrued: number; eligible: number; pendingPayment: number; paid: number };

export async function getCommissionDashboard(actor: Actor): Promise<CommissionDashboard> {
  const rows = await listCommissions(actor);
  let accrued = 0;
  let eligible = 0;
  let pendingPayment = 0;
  let paid = 0;
  for (const r of rows) {
    accrued += r.commissionAmount;
    if (r.eligibilityStatus === "eligible") eligible += r.commissionAmount;
    if (r.paymentStatus === "unpaid" && r.eligibilityStatus === "eligible") pendingPayment += r.commissionAmount;
    if (r.paymentStatus === "paid") paid += r.commissionAmount;
  }
  return { accrued, eligible, pendingPayment, paid };
}

// Writes. Only ops/exec/admin may create invoices or mark commissions
// eligible/paid -- server-action-enforced (see this function's own role
// check), the documented boundary from migrations/0013's header comment.
function assertFinanceWriteAccess(actor: Actor): void {
  if (actor.role === "recruiter") {
    throw new Error("recruiters cannot create or modify invoices/commissions -- view only");
  }
}

export async function createInvoice(
  input: { placementId: string; clientId: string; invoiceNumber: string; amount: number; dueAt: Date },
  actor: Actor,
): Promise<string> {
  assertFinanceWriteAccess(actor);
  return withActor(actor, async (tx: DbTx) => {
    const [created] = await tx
      .insert(invoice)
      .values({ ...input, createdBy: actor.userId })
      .returning({ id: invoice.id });

    await writeEvent(tx, {
      type: "invoice.created",
      source: "manual_ui",
      entityType: "invoice",
      entityId: created!.id,
      payload: input,
      occurredAt: new Date(),
    });
    await writeAuditLog(tx, {
      actorUserId: actor.userId,
      action: "create_invoice",
      entityType: "invoice",
      entityId: created!.id,
      before: null,
      after: input,
    });
    return created!.id;
  });
}

export async function recordPayment(input: { invoiceId: string; amount: number }, actor: Actor): Promise<void> {
  assertFinanceWriteAccess(actor);
  await withActor(actor, async (tx: DbTx) => {
    await tx.insert(payment).values({ invoiceId: input.invoiceId, amount: input.amount, enteredBy: actor.userId });
    await tx.update(invoice).set({ status: "paid", paidAt: new Date() }).where(eq(invoice.id, input.invoiceId));

    await writeEvent(tx, {
      type: "payment.recorded",
      source: "manual_ui",
      entityType: "invoice",
      entityId: input.invoiceId,
      payload: input,
      occurredAt: new Date(),
    });
    await writeAuditLog(tx, {
      actorUserId: actor.userId,
      action: "record_payment",
      entityType: "invoice",
      entityId: input.invoiceId,
      before: null,
      after: input,
    });
  });
}

export async function createCommission(
  input: { placementId: string; recruiterUserId: string; placementFee: number; commissionPercent: number },
  actor: Actor,
): Promise<string> {
  assertFinanceWriteAccess(actor);
  const commissionAmount = (input.placementFee * input.commissionPercent) / 100;
  return withActor(actor, async (tx: DbTx) => {
    const [created] = await tx
      .insert(commission)
      .values({ ...input, commissionAmount })
      .returning({ id: commission.id });
    await writeAuditLog(tx, {
      actorUserId: actor.userId,
      action: "create_commission",
      entityType: "commission",
      entityId: created!.id,
      before: null,
      after: { ...input, commissionAmount },
    });
    return created!.id;
  });
}

export async function markCommissionEligible(commissionId: string, actor: Actor): Promise<void> {
  assertFinanceWriteAccess(actor);
  await withActor(actor, async (tx: DbTx) => {
    await tx.update(commission).set({ eligibilityStatus: "eligible" }).where(eq(commission.id, commissionId));
  });
}

export async function markCommissionPaid(commissionId: string, actor: Actor): Promise<void> {
  assertFinanceWriteAccess(actor);
  await withActor(actor, async (tx: DbTx) => {
    await tx.update(commission).set({ paymentStatus: "paid", paidAt: new Date() }).where(eq(commission.id, commissionId));
  });
}
