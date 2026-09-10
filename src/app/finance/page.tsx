import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { listInvoices, getArSummary, listCommissions, getCommissionDashboard } from "@/finance/queries";
import { listPendingMergeCandidates } from "@/identity/resolver";
import { recordPaymentAction, markCommissionEligibleAction, markCommissionPaidAction } from "./actions";

// Financial Operating System (section 11), internal only. Every number on
// this page is scoped by invoices_for_actor()/commissions_for_actor() at
// the database level (migrations/0013) -- a recruiter sees their own
// placements' invoices and their own commissions, ops/exec/admin see
// everything. This page never checks actor.role itself for READ scoping;
// the database already did, before this page ever saw a row.
export default async function FinancePage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const [invoices, ar, commissions, commissionDash, mergeCandidates] = await Promise.all([
    listInvoices(actor),
    getArSummary(actor),
    listCommissions(actor),
    getCommissionDashboard(actor),
    listPendingMergeCandidates(),
  ]);

  return (
    <AppShell actor={actor} userName={me?.name ?? "You"} activeNav="finance" pageTitle="Finance" mergeQueueCount={mergeCandidates.length}>
      <div className="kpi-row">
        <div className="card kpi">
          <div className="kpi-label">Total Invoiced</div>
          <div className="kpi-value mono">${ar.totalInvoiced.toLocaleString()}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Outstanding</div>
          <div className={`kpi-value mono${ar.outstanding > 0 ? " warn" : ""}`}>${ar.outstanding.toLocaleString()}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Overdue</div>
          <div className={`kpi-value mono${ar.overdue > 0 ? " warn" : ""}`}>${ar.overdue.toLocaleString()}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Collected</div>
          <div className="kpi-value mono">${ar.totalCollected.toLocaleString()}</div>
        </div>
      </div>

      <div className="card">
        <div className="panel-head">
          <h2>A/R Aging</h2>
        </div>
        <div style={{ display: "flex", gap: 0 }}>
          {ar.agingBuckets.map((b) => (
            <div key={b.label} style={{ flex: 1, padding: 20, borderRight: "1px solid var(--line)", textAlign: "center" }}>
              <div className="mono" style={{ fontSize: "1.3rem", color: b.amount > 0 ? "var(--rust)" : "var(--ink)" }}>
                ${b.amount.toLocaleString()}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 4 }}>{b.label} days</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>Invoices</h2>
          <span className="count mono">{invoices.length}</span>
        </div>
        {invoices.length === 0 ? (
          <div className="empty-state">No invoices yet.</div>
        ) : (
          <div className="overflow-x">
            <table className="eng-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Client</th>
                  <th>Placement</th>
                  <th>Amount</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="mono">{inv.invoiceNumber}</td>
                    <td>{inv.clientName}</td>
                    <td>{inv.personName}</td>
                    <td className="fee-cell">${inv.amount.toLocaleString()}</td>
                    <td className="idle-cell">{inv.dueAt.toISOString().slice(0, 10)}</td>
                    <td>
                      <span className={`pill ${inv.status === "paid" ? "pill-verdigris" : inv.dueAt < new Date() ? "pill-rust" : "pill-amber"}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td>
                      {inv.status !== "paid" && (
                        <form action={recordPaymentAction} style={{ display: "flex", gap: 6 }}>
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <input type="hidden" name="amount" value={inv.amount} />
                          <button type="submit" className="btn" style={{ padding: "6px 11px" }}>
                            Record Payment
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="kpi-row" style={{ marginTop: 26 }}>
        <div className="card kpi">
          <div className="kpi-label">Commission Accrued</div>
          <div className="kpi-value mono">${commissionDash.accrued.toLocaleString()}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Eligible</div>
          <div className="kpi-value mono">${commissionDash.eligible.toLocaleString()}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Pending Payment</div>
          <div className="kpi-value mono">${commissionDash.pendingPayment.toLocaleString()}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Paid</div>
          <div className="kpi-value mono">${commissionDash.paid.toLocaleString()}</div>
        </div>
      </div>

      <div className="card">
        <div className="panel-head">
          <h2>Commissions</h2>
          <span className="count mono">{commissions.length}</span>
        </div>
        {commissions.length === 0 ? (
          <div className="empty-state">No commissions yet.</div>
        ) : (
          commissions.map((c) => (
            <div className="list-row" key={c.id}>
              <div className="l-main">
                <span>{c.recruiterName} — {c.personName}</span>
                <span className="t">
                  ${c.placementFee.toLocaleString()} fee × {c.commissionPercent}% = ${c.commissionAmount.toLocaleString()}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className={`pill ${c.eligibilityStatus === "eligible" ? "pill-verdigris" : "pill-slate"}`}>{c.eligibilityStatus}</span>
                <span className={`pill ${c.paymentStatus === "paid" ? "pill-verdigris" : "pill-amber"}`}>{c.paymentStatus}</span>
                {c.eligibilityStatus !== "eligible" && (
                  <form action={markCommissionEligibleAction}>
                    <input type="hidden" name="commissionId" value={c.id} />
                    <button type="submit" className="btn" style={{ padding: "6px 11px" }}>
                      Mark Eligible
                    </button>
                  </form>
                )}
                {c.eligibilityStatus === "eligible" && c.paymentStatus !== "paid" && (
                  <form action={markCommissionPaidAction}>
                    <input type="hidden" name="commissionId" value={c.id} />
                    <button type="submit" className="btn" style={{ padding: "6px 11px" }}>
                      Mark Paid
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
