import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import {
  listInterviewsToday,
  listUpcomingInterviews,
  listAwaitingCandidateDebrief,
  listAwaitingClientFeedback,
  listCompletedInterviews,
  listCanceledInterviews,
  type InterviewRow,
} from "@/interviews/queries";
import { listPendingMergeCandidates } from "@/identity/resolver";
import { markCompletedAction, recordFeedbackAction } from "./actions";

const VIEWS = ["today", "upcoming", "debrief", "feedback", "completed", "canceled"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = {
  today: "Today",
  upcoming: "Upcoming",
  debrief: "Awaiting Debrief",
  feedback: "Awaiting Client Feedback",
  completed: "Completed",
  canceled: "Canceled / Rescheduled",
};

export default async function InterviewsPage({ searchParams }: { searchParams: { view?: string } }) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const view: View = (VIEWS as readonly string[]).includes(searchParams.view ?? "") ? (searchParams.view as View) : "today";
  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const mergeCandidates = await listPendingMergeCandidates();

  let interviews: InterviewRow[];
  if (view === "today") interviews = await listInterviewsToday();
  else if (view === "upcoming") interviews = await listUpcomingInterviews();
  else if (view === "debrief") interviews = await listAwaitingCandidateDebrief();
  else if (view === "feedback") interviews = await listAwaitingClientFeedback();
  else if (view === "completed") interviews = await listCompletedInterviews();
  else interviews = await listCanceledInterviews();

  return (
    <AppShell
      actor={actor}
      userName={me?.name ?? "You"}
      activeNav="interviews"
      pageTitle="Interviews"
      mergeQueueCount={mergeCandidates.length}
      actions={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {VIEWS.map((v) => (
            <a key={v} href={`/interviews?view=${v}`} className={view === v ? "btn btn-primary" : "btn"}>
              {VIEW_LABEL[v]}
            </a>
          ))}
        </div>
      }
    >
      <div className="card">
        <div className="panel-head">
          <h2>{VIEW_LABEL[view]}</h2>
          <span className="count mono">{interviews.length}</span>
        </div>
        {interviews.length === 0 ? (
          <div className="empty-state">Nothing here.</div>
        ) : (
          interviews.map((iv) => (
            <div className="list-row" key={iv.id} style={{ alignItems: "flex-start" }}>
              <div className="l-main">
                <span>
                  {iv.personName} — {iv.jobTitle} <span style={{ color: "var(--ink-faint)" }}>({iv.clientName})</span>
                </span>
                <span className="t">
                  Round {iv.roundNumber} · {iv.interviewType.replace(/_/g, " ")}
                  {iv.scheduledAt && ` · ${iv.scheduledAt.toISOString().slice(0, 16).replace("T", " ")}`}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="pill pill-slate">{iv.status}</span>
                {view === "today" || view === "upcoming" ? (
                  <form action={markCompletedAction}>
                    <input type="hidden" name="interviewId" value={iv.id} />
                    <button type="submit" className="btn" style={{ padding: "6px 11px" }}>
                      Mark Completed
                    </button>
                  </form>
                ) : (view === "debrief" || view === "feedback") ? (
                  <form action={recordFeedbackAction} style={{ display: "flex", gap: 6 }}>
                    <input type="hidden" name="interviewId" value={iv.id} />
                    <input type="hidden" name="side" value={view === "debrief" ? "candidate" : "client"} />
                    <input className="field" name="feedback" placeholder="Feedback…" style={{ minWidth: 180 }} />
                    <button type="submit" className="btn" style={{ padding: "6px 11px" }}>
                      Save
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
