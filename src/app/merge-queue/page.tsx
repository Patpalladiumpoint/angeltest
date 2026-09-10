import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { listPendingMergeCandidates } from "@/identity/resolver";
import { mergeCandidateAction, rejectCandidateAction } from "./actions";

// Phase 1 bullet: "Merge review queue, worked down to zero strong-match
// candidates." Still a plain list with merge/reject buttons per spec 3.2's
// own "a simple two-column review list is sufficient" -- just styled to
// match the rest of the app now.
export default async function MergeQueuePage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const candidates = await listPendingMergeCandidates();

  return (
    <AppShell
      actor={actor}
      userName={me?.name ?? "You"}
      activeNav="merge-queue"
      pageTitle="Merge Queue"
      mergeQueueCount={candidates.length}
    >
      <div className="card">
        <div className="panel-head">
          <h2>Pending Strong-Match Candidates</h2>
          <span className="count mono">{candidates.length}</span>
        </div>

        {candidates.length === 0 ? (
          <div className="empty-state">Nothing pending. The narrow importer and any manual person creation will refill this as new matches surface.</div>
        ) : (
          candidates.map((c) => (
            <div key={c.id} style={{ padding: "18px 20px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                <span style={{ fontFamily: "Fraunces, serif", fontSize: "1.05rem" }}>
                  {c.personAName} <span style={{ color: "var(--ink-faint)", fontWeight: 400 }}>vs</span> {c.personBName}
                </span>
                <span className="pill pill-amber">similarity {c.similarity.toFixed(3)}</span>
              </div>
              <p style={{ margin: "6px 0 14px", fontSize: 12.5, color: "var(--ink-faint)" }}>matched on {c.matchedOn}</p>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <form action={mergeCandidateAction}>
                  <input type="hidden" name="candidateId" value={c.id} />
                  <input type="hidden" name="survivingPersonId" value={c.personAId} />
                  <input type="hidden" name="absorbedPersonId" value={c.personBId} />
                  <button type="submit" className="btn btn-primary">Keep &quot;{c.personAName}&quot;</button>
                </form>
                <form action={mergeCandidateAction}>
                  <input type="hidden" name="candidateId" value={c.id} />
                  <input type="hidden" name="survivingPersonId" value={c.personBId} />
                  <input type="hidden" name="absorbedPersonId" value={c.personAId} />
                  <button type="submit" className="btn btn-primary">Keep &quot;{c.personBName}&quot;</button>
                </form>
                <form action={rejectCandidateAction}>
                  <input type="hidden" name="candidateId" value={c.id} />
                  <button type="submit" className="btn">Not a duplicate</button>
                </form>
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
