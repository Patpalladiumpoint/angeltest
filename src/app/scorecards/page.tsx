import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { getRecruiterScorecards, conversionRate } from "@/scorecards/queries";
import { listPendingMergeCandidates } from "@/identity/resolver";

const RANGES = { "7": "Last 7 Days", "30": "Last 30 Days", "90": "Last Quarter" } as const;

export default async function ScorecardsPage({ searchParams }: { searchParams: { range?: string } }) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const rangeDays = searchParams.range && searchParams.range in RANGES ? searchParams.range : "30";
  const to = new Date();
  const from = new Date(to.getTime() - Number(rangeDays) * 24 * 60 * 60 * 1000);

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const [scorecards, mergeCandidates] = await Promise.all([getRecruiterScorecards(from, to), listPendingMergeCandidates()]);

  return (
    <AppShell
      actor={actor}
      userName={me?.name ?? "You"}
      activeNav="scorecards"
      pageTitle="Team Scorecards"
      mergeQueueCount={mergeCandidates.length}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {Object.entries(RANGES).map(([days, label]) => (
            <a key={days} href={`/scorecards?range=${days}`} className={rangeDays === days ? "btn btn-primary" : "btn"}>
              {label}
            </a>
          ))}
        </div>
      }
    >
      <div className="card">
        <div className="panel-head">
          <h2>Recruiter Performance</h2>
          <span className="count mono">{RANGES[rangeDays as keyof typeof RANGES]}</span>
        </div>
        <div className="overflow-x">
          <table className="eng-table">
            <thead>
              <tr>
                <th>Recruiter</th>
                <th>Sourced</th>
                <th>Submittals</th>
                <th>Interviews</th>
                <th>Offers</th>
                <th>Starts</th>
                <th>Active Pipeline</th>
                <th>Sourced→Start</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {scorecards.map((s) => (
                <tr key={s.recruiterId}>
                  <td style={{ fontWeight: 600 }}>{s.recruiterName}</td>
                  <td className="mono">{s.sourced}</td>
                  <td className="mono">{s.submittals}</td>
                  <td className="mono">{s.interviews}</td>
                  <td className="mono">{s.offers}</td>
                  <td className="mono">{s.starts}</td>
                  <td className="mono">{s.activePipeline}</td>
                  <td className="mono">{conversionRate(s.starts, s.sourced || s.submittals || 1)}%</td>
                  <td className="fee-cell">${s.revenue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
