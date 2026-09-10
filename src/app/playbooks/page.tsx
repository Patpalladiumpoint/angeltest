import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { listPlaybooks } from "@/playbooks/queries";
import { listPendingMergeCandidates } from "@/identity/resolver";

export default async function PlaybooksPage({ searchParams }: { searchParams: { q?: string } }) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const [playbooks, mergeCandidates] = await Promise.all([listPlaybooks(searchParams.q), listPendingMergeCandidates()]);

  return (
    <AppShell
      actor={actor}
      userName={me?.name ?? "You"}
      activeNav="playbooks"
      pageTitle="Playbooks"
      mergeQueueCount={mergeCandidates.length}
      actions={
        <form style={{ display: "flex", gap: 8 }}>
          <input className="field" name="q" defaultValue={searchParams.q ?? ""} placeholder="Search…" style={{ minWidth: 200 }} />
          <a href="/playbooks/new" className="btn btn-primary">
            + New
          </a>
        </form>
      }
    >
      <div className="card">
        <div className="panel-head">
          <h2>All Playbooks</h2>
          <span className="count mono">{playbooks.length}</span>
        </div>
        {playbooks.length === 0 ? (
          <div className="empty-state">No playbooks yet.</div>
        ) : (
          playbooks.map((p) => (
            <div className="list-row" key={p.id}>
              <div className="l-main">
                <span><a href={`/playbooks/${p.id}`} style={{ fontWeight: 600 }}>{p.title}</a></span>
                <span className="t">{p.ownerName ?? "unowned"} · updated {p.updatedAt.toISOString().slice(0, 10)}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <span className="pill pill-slate">{p.category.replace(/_/g, " ")}</span>
                <span className={`pill ${p.status === "active" ? "pill-verdigris" : p.status === "archived" ? "pill-slate" : "pill-amber"}`}>
                  {p.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
