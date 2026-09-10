import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { listActiveEngagements, getPipelineKpis, STALE_DAYS_THRESHOLD } from "@/engagements/queries";
import { listOverdueTasks } from "@/tasks/queries";
import { listInterviewsToday } from "@/interviews/queries";
import { getArSummary } from "@/finance/queries";
import { OPEN_STAGES } from "@/domain/stages";

const STAGE_PILL: Record<string, string> = {
  sourced: "pill-slate",
  outreach: "pill-rust",
  engaged: "pill-rust",
  qualified: "pill-slate",
  submitted: "pill-brass",
  client_process: "pill-slate",
  offer: "pill-brass",
  placed: "pill-verdigris",
  secured: "pill-verdigris",
  candidate_declined: "pill-rust",
  client_rejected: "pill-rust",
  withdrawn: "pill-slate",
  on_hold: "pill-amber",
  fell_off: "pill-rust",
};

function stageLabel(stage: string): string {
  return stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Must mirror getPipelineKpis()'s own "stalled" definition (src/engagements/
// queries.ts, is_open_engagement_stage() in migration 0018): sitting in a
// closed-won stage (placed/secured), a closed-lost stage, or a nurture
// stage for a long time is normal, not a problem -- only a still-open
// pipeline stage sitting idle is a real stall. Without this check a row in
// any of those stages sits at row.daysInStage >= threshold just because
// it's been closed (won OR lost) or parked for months, and gets flagged in
// the same alarming rust-red idle-cell as a genuinely stalled search --
// directly contradicting the "Stalled" KPI tile above the table, which
// already excludes them. Reuses OPEN_STAGES (src/domain/stages.ts) rather
// than a locally redeclared stage set, so this can't drift from the SQL
// side's is_open_engagement_stage() the way the placed/secured-only
// version of this check had already drifted from closed-lost/nurture.
const OPEN_STAGE_SET: ReadonlySet<string> = new Set(OPEN_STAGES);
function isStalled(stage: string, daysInStage: number): boolean {
  return daysInStage >= STALE_DAYS_THRESHOLD && OPEN_STAGE_SET.has(stage);
}

function initials(name: string): string {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

// The internal Pipeline view -- replaces the old bare data-quality dump at
// this URL (that report now lives at /data-quality, still linked from the
// sidebar). This is the page a recruiter actually opens dozens of times a
// day, so it leads with the table, not a report.
export default async function DashboardPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const [engagements, kpis, overdueTasks, interviewsToday, ar] = await Promise.all([
    listActiveEngagements(),
    getPipelineKpis(),
    listOverdueTasks(),
    listInterviewsToday(),
    getArSummary(actor),
  ]);

  return (
    <AppShell
      actor={actor}
      userName={me?.name ?? "You"}
      activeNav="pipeline"
      pageTitle="Pipeline"
      mergeQueueCount={kpis.pendingMerges}
      overdueTaskCount={overdueTasks.length}
    >
      {/* Executive summary strip (section 13): "what needs attention" at a
          glance. Deliberately not a full re-implementation of DCT/Finance/
          Scorecards here -- each of those pages already owns its detail
          view; this is three numbers with a link to where the detail
          actually lives, matching the brief's own "clarity over
          completeness" instruction rather than duplicating full tables. */}
      {(overdueTasks.length > 0 || interviewsToday.length > 0 || ar.overdue > 0) && (
        <div className="kpi-row" style={{ marginBottom: 22 }}>
          <a href="/dct?view=overdue" className="card kpi" style={{ display: "block" }}>
            <div className="kpi-label">Needs Attention</div>
            <div className="kpi-value mono warn">{overdueTasks.length}</div>
            <div className="kpi-sub">overdue tasks →</div>
          </a>
          <a href="/interviews" className="card kpi" style={{ display: "block" }}>
            <div className="kpi-label">Today</div>
            <div className="kpi-value mono">{interviewsToday.length}</div>
            <div className="kpi-sub">interviews scheduled →</div>
          </a>
          <a href="/finance" className="card kpi" style={{ display: "block" }}>
            <div className="kpi-label">Financial Flags</div>
            <div className={`kpi-value mono${ar.overdue > 0 ? " warn" : ""}`}>${ar.overdue.toLocaleString()}</div>
            <div className="kpi-sub">overdue A/R →</div>
          </a>
        </div>
      )}

      <div className="kpi-row">
        <div className="card kpi">
          <div className="kpi-label">Active Engagements</div>
          <div className="kpi-value mono">{kpis.activeEngagements}</div>
          <div className="kpi-sub">Across every open search</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Stalled &gt; {STALE_DAYS_THRESHOLD}d</div>
          <div className={`kpi-value mono${kpis.stalledCount > 0 ? " warn" : ""}`}>{kpis.stalledCount}</div>
          <div className="kpi-sub">Revenue at risk ${kpis.revenueAtRisk.toLocaleString()}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Pending Merges</div>
          <div className="kpi-value mono">{kpis.pendingMerges}</div>
          <div className="kpi-sub">Strong-match candidates</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Placements — MTD</div>
          <div className="kpi-value mono">{kpis.placementsMtd}</div>
          <div className="kpi-sub">${kpis.placementsMtdFee.toLocaleString()} expected fee</div>
        </div>
      </div>

      <div className="card">
        <div className="panel-head">
          <h2>Active Engagements</h2>
          <span className="count mono">{engagements.length} total</span>
        </div>
        {engagements.length === 0 ? (
          <div className="empty-state">No active engagements yet. Run the narrow importer or add one manually.</div>
        ) : (
          <div className="overflow-x">
            <table className="eng-table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Job</th>
                  <th>Stage</th>
                  <th>Owner</th>
                  <th>Days in Stage</th>
                  <th>Expected Fee</th>
                </tr>
              </thead>
              <tbody>
                {engagements.map((row) => (
                  <tr key={row.engagementId}>
                    <td>
                      <div className="cand-cell">
                        <div className="avatar">{initials(row.personName)}</div>
                        <div>
                          <span className="name">{row.personName}</span>
                          {row.currentEmployer && <span className="sub">{row.currentEmployer}</span>}
                        </div>
                      </div>
                    </td>
                    <td>{row.jobTitle}</td>
                    <td>
                      <span className={`pill ${STAGE_PILL[row.currentStage] ?? "pill-slate"}`}>{stageLabel(row.currentStage)}</span>
                    </td>
                    <td>
                      <div className="owner-cell">
                        <div className="avatar sm">{row.ownerName ? initials(row.ownerName) : "—"}</div>
                        {row.ownerName ?? "unassigned"}
                      </div>
                    </td>
                    <td className={`idle-cell${isStalled(row.currentStage, row.daysInStage) ? " hot" : ""}`}>{row.daysInStage}d</td>
                    <td className="fee-cell">{row.expectedFee ? `$${row.expectedFee.toLocaleString()}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
