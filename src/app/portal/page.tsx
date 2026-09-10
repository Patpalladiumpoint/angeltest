import { redirect } from "next/navigation";
import { getPortalActor } from "@/portal/session";
import { getClientPortalJobs, getClientPortalActivity, FUNNEL_STEPS } from "@/portal/queries";
import { db } from "@/db/client";
import { client, brokerage } from "@/db/schema";
import { eq } from "drizzle-orm";
import { portalSignOut } from "./sign-in/actions";

const EVENT_LABEL: Record<string, string> = {
  "engagement.imported": "Search launched",
  "engagement.reimported": "Search updated",
  "person.merged": "Candidate record consolidated",
  "person.merge_reversed": "Candidate record correction",
};

function stageLabel(stage: string): string {
  return stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function PortalDashboardPage() {
  const portalActor = await getPortalActor();
  if (!portalActor) redirect("/portal/sign-in");

  const [brokerageRow] = await db
    .select({ name: brokerage.name })
    .from(client)
    .innerJoin(brokerage, eq(brokerage.id, client.brokerageId))
    .where(eq(client.id, portalActor.clientId))
    .limit(1);

  const [jobs, activity] = await Promise.all([
    getClientPortalJobs(portalActor.clientId),
    getClientPortalActivity(portalActor.clientId),
  ]);

  return (
    <div className="cp-wrap">
      <div className="cp-topbar">
        <div className="cp-brand">
          <div className="mark">P</div>
          <div className="name">
            Palladium Point
            <small>CLIENT PORTAL</small>
          </div>
        </div>
        <div className="cp-account">
          {brokerageRow?.name ?? "Your firm"}
          <div className="avatar">
            {portalActor.name
              .split(" ")
              .map((p) => p[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <form action={portalSignOut}>
            <button type="submit" className="btn" style={{ padding: "6px 11px" }}>
              Sign Out
            </button>
          </form>
        </div>
      </div>

      <div className="cp-hero">
        <p className="eyebrow">Welcome back</p>
        <h1>Your active searches with Palladium Point.</h1>
        <p>
          {jobs.length} search{jobs.length === 1 ? "" : "es"} in flight. Everything below reflects where things stand right
          now — no need to wait on a status call.
        </p>
      </div>

      {jobs.length === 0 && <div className="card empty-state">No searches on file yet.</div>}

      {jobs.map((job) => (
        <div className="card job-card" key={job.jobId}>
          <div className="job-card-head">
            <div>
              <h3>{job.title}</h3>
              <div className="job-meta">Opened {job.createdAt.toISOString().slice(0, 10)} · Owner: Palladium Point desk</div>
            </div>
            <span className={`pill ${job.funnelIndex >= 5 ? "pill-verdigris" : job.funnelIndex >= 2 ? "pill-brass" : "pill-slate"}`}>
              {job.funnelIndex < 0 ? "Sourcing" : FUNNEL_STEPS[job.funnelIndex]}
            </span>
          </div>

          <div className="funnel">
            {FUNNEL_STEPS.map((step, i) => (
              <div key={step} className={`funnel-step ${i < job.funnelIndex ? "done" : i === job.funnelIndex ? "current" : ""}`}>
                <div className="bar" />
                <div className="flabel">{step}</div>
              </div>
            ))}
          </div>

          {job.presentedCount > 0 ? (
            <>
              <div className="job-stats">
                <div className="job-stat">
                  <div className="v mono">{job.presentedCount}</div>
                  <div className="k">Candidate{job.presentedCount === 1 ? "" : "s"} presented</div>
                </div>
              </div>
              {job.candidates.map((c) => (
                <div className="cand-row" key={`${job.jobId}-${c.personName}`}>
                  <div className="who">
                    <div className="avatar">
                      {c.personName
                        .split(" ")
                        .map((p) => p[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div>
                      <div className="n">{c.personName}</div>
                      <div className="t">
                        {stageLabel(c.stage)} — updated {c.daysInStage}d ago
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <p style={{ color: "var(--ink-faint)", fontSize: 12.5, marginTop: 14 }}>
              Mapping the Top 100 against this seat now — candidates appear here once contacted and engaged, not before.
            </p>
          )}
        </div>
      ))}

      {activity.length > 0 && (
        <div className="cp-activity">
          <h2 style={{ fontSize: "1.05rem", marginBottom: 6 }}>Recent activity</h2>
          {activity.map((a, i) => (
            <div className="activity-item" key={i}>
              <div className="when mono">{a.occurredAt.toISOString().slice(0, 10)}</div>
              <div className="what">
                <b>{EVENT_LABEL[a.type] ?? a.type}</b>
                {a.jobTitle && <span className="ctx"> — {a.jobTitle}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
