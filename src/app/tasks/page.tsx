import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { listMyTasks, listTeamTasks, listDueTodayTasks, listOverdueTasks, type TaskRow } from "@/tasks/queries";
import { listPendingMergeCandidates } from "@/identity/resolver";
import { completeTaskAction } from "./actions";

const VIEWS = ["mine", "team", "due_today", "overdue"] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABEL: Record<View, string> = {
  mine: "Mine",
  team: "Team",
  due_today: "Due Today",
  overdue: "Overdue",
};

export default async function TasksPage({ searchParams }: { searchParams: { view?: string } }) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const view: View = (VIEWS as readonly string[]).includes(searchParams.view ?? "") ? (searchParams.view as View) : "mine";

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const mergeCandidates = await listPendingMergeCandidates();

  let tasks: TaskRow[];
  if (view === "mine") tasks = await listMyTasks(actor.userId);
  else if (view === "team") tasks = await listTeamTasks();
  else if (view === "due_today") tasks = await listDueTodayTasks();
  else tasks = await listOverdueTasks();

  const overdueCount = (await listOverdueTasks()).length;

  return (
    <AppShell
      actor={actor}
      userName={me?.name ?? "You"}
      activeNav="tasks"
      pageTitle="Tasks"
      mergeQueueCount={mergeCandidates.length}
      overdueTaskCount={overdueCount}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {VIEWS.map((v) => (
            <a key={v} href={`/tasks?view=${v}`} className={view === v ? "btn btn-primary" : "btn"}>
              {VIEW_LABEL[v]}
            </a>
          ))}
        </div>
      }
    >
      <div className="card">
        <div className="panel-head">
          <h2>{VIEW_LABEL[view]}</h2>
          <span className="count mono">{tasks.length}</span>
        </div>
        {tasks.length === 0 ? (
          <div className="empty-state">Nothing here.</div>
        ) : (
          tasks.map((t) => (
            <div className="list-row" key={t.id}>
              <div className="l-main">
                <span>{t.type}</span>
                <span className="t">
                  {t.entityLabel ?? "—"} · {t.assigneeName ?? "unassigned"}
                  {t.dueAt && ` · due ${t.dueAt.toISOString().slice(0, 10)}`}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className={`pill ${t.priority === "urgent" || t.priority === "high" ? "pill-rust" : "pill-slate"}`}>
                  {t.category.replace(/_/g, " ")}
                </span>
                <form action={completeTaskAction}>
                  <input type="hidden" name="taskId" value={t.id} />
                  <button type="submit" className="btn" style={{ padding: "6px 11px" }}>
                    Complete
                  </button>
                </form>
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
