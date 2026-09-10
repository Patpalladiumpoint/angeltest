import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { listOpenDeals, listRecentlyClosedDeals, type DctDeal } from "@/dct/queries";
import { listPendingMergeCandidates } from "@/identity/resolver";
import { slaStatus, SLA_STATUS_PILL, SLA_STATUS_LABEL, SLA_ZONE_LABEL, type SlaZone } from "@/domain/sla";
import { stageLabel } from "@/domain/stages";

// Deal Control Tower (section 6). One query (listOpenDeals) feeds every
// required view -- Active Deals, Needs Action Today, Overdue, Waiting on
// Client/Candidate/Recruiter, Upcoming Interviews, Offer/Pending Start,
// Recently Closed -- sliced here so they can never disagree about what
// "overdue" means the way the pipeline table and its KPI tile once did.
export default async function DctPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const [deals, closed, mergeCandidates] = await Promise.all([
    listOpenDeals(),
    listRecentlyClosedDeals(),
    listPendingMergeCandidates(),
  ]);

  const now = new Date();
  const withStatus = deals.map((d) => ({ ...d, status: slaStatus(d.dueAt, null, now) }));

  const overdue = withStatus.filter((d) => d.status === "overdue");
  const dueToday = withStatus.filter((d) => d.dueAt && d.dueAt.toDateString() === now.toDateString() && d.status !== "overdue");
  const waitingOnClient = withStatus.filter((d) => d.taskCategory === "client_follow_up");
  const waitingOnCandidate = withStatus.filter((d) => d.taskCategory === "candidate_follow_up");
  const waitingOnRecruiter = withStatus.filter((d) => d.taskCategory === "interview" || d.taskCategory === "offer");
  const upcomingInterviews = withStatus.filter((d) => d.nextInterviewAt);
  const offerPendingStart = withStatus.filter((d) => d.currentStage === "offer" || d.currentStage === "pending_start");

  return (
    <AppShell actor={actor} userName={me?.name ?? "You"} activeNav="dct" pageTitle="Deal Control Tower" mergeQueueCount={mergeCandidates.length}>
      <div className="kpi-row">
        <Kpi label="Active Deals" value={deals.length} />
        <Kpi label="Overdue" value={overdue.length} warn={overdue.length > 0} />
        <Kpi label="Due Today" value={dueToday.length} />
        <Kpi label="Upcoming Interviews" value={upcomingInterviews.length} />
      </div>

      <DealTable title="Overdue" deals={overdue} emptyText="Nothing overdue. Clean board." />
      <DealTable title="Needs Action Today" deals={dueToday} emptyText="Nothing due today." />

      <div className="split-panels">
        <DealTable title="Waiting on Client" deals={waitingOnClient} emptyText="No open client feedback loops." compact />
        <DealTable title="Waiting on Candidate" deals={waitingOnCandidate} emptyText="No open candidate follow-ups." compact />
      </div>
      <div className="split-panels">
        <DealTable title="Waiting on Recruiter" deals={waitingOnRecruiter} emptyText="Nothing sitting on our side." compact />
        <DealTable title="Upcoming Interviews" deals={upcomingInterviews} emptyText="Nothing scheduled." compact showInterview />
      </div>

      <DealTable title="Offer / Pending Start" deals={offerPendingStart} emptyText="No offers in flight." />

      <div className="card" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>Recently Closed</h2>
          <span className="count mono">{closed.length}</span>
        </div>
        {closed.length === 0 ? (
          <div className="empty-state">Nothing closed in the last 14 days.</div>
        ) : (
          closed.map((c) => (
            <div className="list-row" key={c.engagementId}>
              <div className="l-main">
                <span>{c.personName} — {c.jobTitle}</span>
                <span className="t">{c.clientName} · closed {c.closedAt.toISOString().slice(0, 10)}</span>
              </div>
              <span className="pill pill-verdigris">{stageLabel(c.currentStage)}</span>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}

function Kpi({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value mono${warn ? " warn" : ""}`}>{value}</div>
    </div>
  );
}

function DealTable({
  title,
  deals,
  emptyText,
  compact,
  showInterview,
}: {
  title: string;
  deals: (DctDeal & { status: ReturnType<typeof slaStatus> })[];
  emptyText: string;
  compact?: boolean;
  showInterview?: boolean;
}) {
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="panel-head">
        <h2>{title}</h2>
        <span className="count mono">{deals.length}</span>
      </div>
      {deals.length === 0 ? (
        <div className="empty-state">{emptyText}</div>
      ) : compact ? (
        deals.map((d) => (
          <div className="list-row" key={d.engagementId}>
            <div className="l-main">
              <span>{d.personName} — {d.jobTitle}</span>
              <span className="t">{d.clientName} · {d.ownerName ?? "unassigned"}</span>
            </div>
            {showInterview && d.nextInterviewAt ? (
              <span className="pill pill-brass">{d.nextInterviewAt.toISOString().slice(0, 16).replace("T", " ")}</span>
            ) : (
              <span className={`pill ${SLA_STATUS_PILL[d.status]}`}>{SLA_STATUS_LABEL[d.status]}</span>
            )}
          </div>
        ))
      ) : (
        <div className="overflow-x">
          <table className="eng-table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Client / Job</th>
                <th>Stage</th>
                <th>Owner</th>
                <th>SLA Zone</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.engagementId}>
                  <td className="cand-cell">{d.personName}</td>
                  <td>{d.clientName} — {d.jobTitle}</td>
                  <td><span className="pill pill-slate">{stageLabel(d.currentStage)}</span></td>
                  <td>{d.ownerName ?? "unassigned"}</td>
                  <td style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>
                    {d.slaZone ? SLA_ZONE_LABEL[d.slaZone as SlaZone] : "—"}
                  </td>
                  <td><span className={`pill ${SLA_STATUS_PILL[d.status]}`}>{SLA_STATUS_LABEL[d.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
