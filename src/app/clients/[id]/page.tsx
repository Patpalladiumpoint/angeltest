import { redirect, notFound } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import {
  getClientDetail,
  getClientJobs,
  getClientPlacements,
  getClientContacts,
  getClientFinancialSummary,
} from "@/clients/queries";
import { listPendingMergeCandidates } from "@/identity/resolver";
import { addClientContactAction } from "./actions";

// Client 360 (section 8) plus the Client Contacts view (section 8's own
// callout). Financial summary is fetched for every internal role here --
// invoices_for_actor() (migrations/0013) already returns a truthful,
// correctly-scoped answer for a recruiter (their own placements only),
// so there's no role branch needed in the page itself.
export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const [detail, jobs, placements, contacts, financials, mergeCandidates] = await Promise.all([
    getClientDetail(params.id),
    getClientJobs(params.id),
    getClientPlacements(params.id),
    getClientContacts(params.id),
    getClientFinancialSummary(params.id, actor),
    listPendingMergeCandidates(),
  ]);
  if (!detail) notFound();

  return (
    <AppShell
      actor={actor}
      userName={me?.name ?? "You"}
      activeNav="clients"
      pageTitle={detail.brokerageName}
      mergeQueueCount={mergeCandidates.length}
    >
      <div className="kpi-row">
        <div className="card kpi">
          <div className="kpi-label">Brokerage Rank</div>
          <div className="kpi-value mono">{detail.brokerageRank ?? "—"}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Total Invoiced</div>
          <div className="kpi-value mono">${financials.totalInvoiced.toLocaleString()}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Outstanding</div>
          <div className={`kpi-value mono${financials.outstanding > 0 ? " warn" : ""}`}>${financials.outstanding.toLocaleString()}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Open Invoices</div>
          <div className="kpi-value mono">{financials.openInvoices}</div>
        </div>
      </div>

      <div className="split-panels" style={{ marginTop: 0 }}>
        <div className="card">
          <div className="panel-head">
            <h2>Open Jobs</h2>
            <span className="count mono">{jobs.length}</span>
          </div>
          {jobs.length === 0 ? (
            <div className="empty-state">No jobs yet.</div>
          ) : (
            jobs.map((j) => (
              <div className="list-row" key={j.jobId}>
                <div className="l-main">
                  <span>{j.title}</span>
                  <span className="t">{j.openEngagements} active engagement{j.openEngagements === 1 ? "" : "s"}</span>
                </div>
                <span className="pill pill-slate">{j.status}</span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="panel-head">
            <h2>Placements</h2>
            <span className="count mono">{placements.length}</span>
          </div>
          {placements.length === 0 ? (
            <div className="empty-state">No placements yet.</div>
          ) : (
            placements.map((p, i) => (
              <div className="list-row" key={i}>
                <div className="l-main">
                  <span>{p.personName} — {p.jobTitle}</span>
                  <span className="t">{p.startDate ? p.startDate.toISOString().slice(0, 10) : "no start date"}</span>
                </div>
                <span className="pill pill-verdigris">{p.status}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>Client Contacts (Portal Access)</h2>
          <span className="count mono">{contacts.length}</span>
        </div>
        {contacts.map((c) => (
          <div className="list-row" key={c.id}>
            <div className="l-main">
              <span>{c.name}</span>
              <span className="t">{c.email}</span>
            </div>
            <span className={`pill ${c.isActive ? "pill-verdigris" : "pill-slate"}`}>{c.isActive ? "Active" : "Inactive"}</span>
          </div>
        ))}
        <form action={addClientContactAction} style={{ display: "flex", gap: 8, padding: 20, borderTop: "1px solid var(--line)" }}>
          <input type="hidden" name="clientId" value={params.id} />
          <input className="field" name="name" placeholder="Name" required style={{ flex: 1 }} />
          <input className="field" name="email" type="email" placeholder="Email" required style={{ flex: 1 }} />
          <button type="submit" className="btn btn-primary">
            Add Contact
          </button>
        </form>
      </div>
    </AppShell>
  );
}
