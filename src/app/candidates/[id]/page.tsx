import { redirect, notFound } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db, withActor } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { getCandidateDetail, getCandidateEngagements, getCandidateTimeline } from "@/candidates/queries";
import { listPendingMergeCandidates } from "@/identity/resolver";
import { stageLabel } from "@/domain/stages";
import { readPersonEmploymentComp } from "@/compensation/reads";

// Candidate 360 (section 7). Comp is deliberately NOT fetched here by
// default -- reading it audits the access (migrations/0007's
// get_person_employment_comp()), so it's only pulled when the page is
// asked to show it, not on every page view regardless of whether anyone
// looked. See the "Show compensation" form below.
export default async function CandidateDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { showComp?: string };
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const [detail, engagements, timeline, mergeCandidates] = await Promise.all([
    getCandidateDetail(params.id),
    getCandidateEngagements(params.id),
    getCandidateTimeline(params.id),
    listPendingMergeCandidates(),
  ]);
  if (!detail) notFound();

  let comp: unknown = null;
  const currentEmployment = detail.employment.find((e) => e.isCurrent);
  if (searchParams.showComp === "1" && currentEmployment) {
    comp = await withActor(actor, (tx) => readPersonEmploymentComp(tx, currentEmployment.id));
  }

  return (
    <AppShell
      actor={actor}
      userName={me?.name ?? "You"}
      activeNav="candidates"
      pageTitle={detail.primaryName}
      mergeQueueCount={mergeCandidates.length}
    >
      {detail.doNotContact && (
        <div className="card" style={{ padding: 16, marginBottom: 18, borderColor: "var(--rust)" }}>
          <span className="pill pill-rust">Do Not Contact</span>
          {detail.dncReason && <span style={{ marginLeft: 10, fontSize: 13, color: "var(--ink-muted)" }}>{detail.dncReason}</span>}
        </div>
      )}

      <div className="split-panels" style={{ marginTop: 0 }}>
        <div className="card">
          <div className="panel-head">
            <h2>Profile</h2>
          </div>
          <div style={{ padding: 20 }}>
            {detail.employment.map((e, i) => (
              <div key={i} style={{ marginBottom: 10, fontSize: 13.5 }}>
                <strong>{e.employerName}</strong>
                {e.title && ` — ${e.title}`}
                {e.isCurrent && <span className="pill pill-verdigris" style={{ marginLeft: 8 }}>Current</span>}
              </div>
            ))}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
              {detail.identifiers.map((id, i) => (
                <div key={i} style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>
                  {id.type}: {id.value}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
              {comp ? (
                <pre style={{ fontSize: 12, background: "var(--surface-sunk)", padding: 10, borderRadius: 4 }}>
                  {JSON.stringify(comp, null, 2)}
                </pre>
              ) : (
                <a className="btn" href={`?showComp=1`}>
                  Show Compensation (audited read)
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="panel-head">
            <h2>Active Engagements</h2>
            <span className="count mono">{engagements.length}</span>
          </div>
          {engagements.length === 0 ? (
            <div className="empty-state">No engagements yet.</div>
          ) : (
            engagements.map((e) => (
              <div className="list-row" key={e.engagementId}>
                <div className="l-main">
                  <span>{e.jobTitle}</span>
                  <span className="t">
                    {e.clientName} · {e.ownerName ?? "unassigned"} · {e.daysInStage}d in stage
                  </span>
                </div>
                <span className="pill pill-slate">{stageLabel(e.currentStage)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>Activity Timeline</h2>
          <span className="count mono">{timeline.length}</span>
        </div>
        {timeline.length === 0 ? (
          <div className="empty-state">No activity recorded yet.</div>
        ) : (
          timeline.map((t, i) => (
            <div className="activity-item" key={i} style={{ padding: "13px 20px" }}>
              <div className="when mono">{t.occurredAt.toISOString().slice(0, 10)}</div>
              <div className="what">
                <span className="pill pill-slate" style={{ marginRight: 8 }}>
                  {t.kind.replace(/_/g, " ")}
                </span>
                {t.summary}
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
