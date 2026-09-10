import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { listActiveEngagements, getPipelineKpis, STALE_DAYS_THRESHOLD } from "@/engagements/queries";

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
// queries.ts): sitting in 'placed' or 'secured' for a long time is the
// normal, good outcome, not a problem. Without this check a row in one of
// those stages sits at row.daysInStage >= threshold just because a
// placement has been secured for months, and gets flagged in the same
// alarming rust-red idle-cell as a genuinely stalled search -- directly
// contradicting the "Stalled" KPI tile above the table, which already
// excludes them.
const TERMINAL_STAGES = new Set(["placed", "secured"]);
function isStalled(stage: string, daysInStage: number): boolean {
  return daysInStage >= STALE_DAYS_THRESHOLD && !TERMINAL_STAGES.has(stage);
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
  const [engagements, kpis] = await Promise.all([listActiveEngagements(), getPipelineKpis()]);

  return (
    <AppShell actor={actor} userName={me?.name ?? "You"} activeNav="pipeline" pageTitle="Pipeline" mergeQueueCount={kpis.pendingMerges}>
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
