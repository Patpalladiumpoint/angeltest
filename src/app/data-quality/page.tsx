import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { runDataQualityReport } from "@/dataquality/report";
import { listPendingMergeCandidates } from "@/identity/resolver";

// Phase 1 week-2 deliverable: the data quality report (spec Phase 1
// bullet). Moved here from /dashboard once that URL became the Pipeline
// view -- see src/dataquality/report.ts for what each section means.
export default async function DataQualityPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const [report, mergeCandidates] = await Promise.all([runDataQualityReport(), listPendingMergeCandidates()]);

  return (
    <AppShell
      actor={actor}
      userName={me?.name ?? "You"}
      activeNav="data-quality"
      pageTitle="Data Quality"
      mergeQueueCount={mergeCandidates.length}
    >
      <Panel title="Unmappable Stages" count={report.unmappableStages.length}>
        {report.unmappableStages.map((r) => (
          <div className="list-row" key={r.externalId}>
            <div className="l-main">
              <span>{r.externalId}</span>
              <span className="t">&quot;{r.stage}&quot; at {r.occurredAt.toISOString().slice(0, 10)}</span>
            </div>
            <span className="pill pill-rust">Unmapped</span>
          </div>
        ))}
      </Panel>

      <Panel title="Duplicate Persons Pending Review" count={report.duplicatePersons.length}>
        {report.duplicatePersons.map((r) => (
          <div className="list-row" key={`${r.personAId}-${r.personBId}`}>
            <div className="l-main">
              <span>{r.personAName} ↔ {r.personBName}</span>
              <span className="t">similarity {r.similarity.toFixed(3)}</span>
            </div>
            <a className="btn" style={{ padding: "6px 11px" }} href="/merge-queue">Review</a>
          </div>
        ))}
      </Panel>

      <Panel title="Engagements With No Owner" count={report.ownerlessEngagements.length}>
        {report.ownerlessEngagements.map((r) => (
          <div className="list-row" key={r.engagementId}>
            <div className="l-main">
              <span>{r.personName}</span>
              <span className="t">{r.jobTitle}</span>
            </div>
            <span className="pill pill-slate">{r.stage.replace(/_/g, " ")}</span>
          </div>
        ))}
      </Panel>

      <Panel title="Placements With No Invoice" count={report.placementsWithoutInvoice.length}>
        {report.placementsWithoutInvoice.map((r) => (
          <div className="list-row" key={r.placementId}>
            <div className="l-main">
              <span>{r.personName}</span>
              <span className="t">started {r.startDate?.toISOString().slice(0, 10) ?? "unknown"}</span>
            </div>
            <span className="pill pill-amber">No Invoice</span>
          </div>
        ))}
      </Panel>

      <Panel title="Placements Missing a Start Date" count={report.missingStartDates.length}>
        {report.missingStartDates.map((r) => (
          <div className="list-row" key={r.placementId}>
            <div className="l-main">
              <span>{r.personName}</span>
              <span className="t">status {r.status}</span>
            </div>
            <span className="pill pill-amber">Missing Date</span>
          </div>
        ))}
      </Panel>

      <Panel title="Stalled Engagements — Ranked by Days Idle × Expected Fee" count={report.stalledEngagements.length}>
        {report.stalledEngagements.map((r) => (
          <div className="list-row" key={r.engagementId}>
            <div className="l-main">
              <span>{r.personName} — {r.jobTitle}</span>
              <span className="t">
                {r.daysIdle}d idle · {r.expectedFee ? `$${r.expectedFee.toLocaleString()}` : "fee unset"} · risk {r.riskScore.toFixed(0)}
              </span>
            </div>
            <span className="pill pill-rust">{r.stage.replace(/_/g, " ")}</span>
          </div>
        ))}
      </Panel>

      <Panel title="Document Parse Failures" count={report.parseFailures.length}>
        {report.parseFailures.map((r) => (
          <div className="list-row" key={r.documentId}>
            <div className="l-main"><span>{r.filename}</span></div>
            <span className="pill pill-rust">Failed</span>
          </div>
        ))}
      </Panel>
    </AppShell>
  );
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="panel-head">
        <h2>{title}</h2>
        <span className="count mono">{count}</span>
      </div>
      {count === 0 ? <div className="empty-state">Nothing here. Good.</div> : children}
    </div>
  );
}
