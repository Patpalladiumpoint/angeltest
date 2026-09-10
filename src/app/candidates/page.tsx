import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { listCandidates } from "@/candidates/queries";
import { listPendingMergeCandidates } from "@/identity/resolver";

export default async function CandidatesPage({ searchParams }: { searchParams: { q?: string } }) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const [candidates, mergeCandidates] = await Promise.all([listCandidates(searchParams.q), listPendingMergeCandidates()]);

  return (
    <AppShell
      actor={actor}
      userName={me?.name ?? "You"}
      activeNav="candidates"
      pageTitle="Candidates"
      mergeQueueCount={mergeCandidates.length}
      actions={
        <form>
          <input className="field" name="q" defaultValue={searchParams.q ?? ""} placeholder="Search by name…" style={{ minWidth: 220 }} />
        </form>
      }
    >
      <div className="card">
        <div className="panel-head">
          <h2>All Candidates</h2>
          <span className="count mono">{candidates.length}</span>
        </div>
        {candidates.length === 0 ? (
          <div className="empty-state">No candidates match.</div>
        ) : (
          <div className="overflow-x">
            <table className="eng-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Employer</th>
                  <th>Title</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.personId}>
                    <td>
                      <a href={`/candidates/${c.personId}`} style={{ fontWeight: 600 }}>
                        {c.primaryName}
                      </a>
                      {c.doNotContact && <span className="pill pill-rust" style={{ marginLeft: 8 }}>DNC</span>}
                    </td>
                    <td>{c.currentEmployer ?? "—"}</td>
                    <td>{c.currentTitle ?? "—"}</td>
                    <td>{c.ownerName ?? "unassigned"}</td>
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
