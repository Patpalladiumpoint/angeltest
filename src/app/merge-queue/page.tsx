import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { listPendingMergeCandidates } from "@/identity/resolver";
import { mergeCandidateAction, rejectCandidateAction } from "./actions";

// Phase 1 bullet: "Merge review queue, worked down to zero strong-match
// candidates." Deliberately a plain two-column list with merge/reject
// buttons -- spec 3.2 only requires a human decide, not a rich UI for it.
export default async function MergeQueuePage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const candidates = await listPendingMergeCandidates();

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1>Merge review queue</h1>
      <p>{candidates.length} pending strong-match candidate{candidates.length === 1 ? "" : "s"}.</p>

      {candidates.map((c) => (
        <div key={c.id} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 16, marginTop: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#555" }}>
            similarity {c.similarity.toFixed(3)} &middot; matched on {c.matchedOn}
          </p>
          <p style={{ margin: "8px 0", fontWeight: 600 }}>
            {c.personAName} &nbsp;vs&nbsp; {c.personBName}
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form action={mergeCandidateAction}>
              <input type="hidden" name="candidateId" value={c.id} />
              <input type="hidden" name="survivingPersonId" value={c.personAId} />
              <input type="hidden" name="absorbedPersonId" value={c.personBId} />
              <button type="submit">Keep &quot;{c.personAName}&quot;, merge the other in</button>
            </form>
            <form action={mergeCandidateAction}>
              <input type="hidden" name="candidateId" value={c.id} />
              <input type="hidden" name="survivingPersonId" value={c.personBId} />
              <input type="hidden" name="absorbedPersonId" value={c.personAId} />
              <button type="submit">Keep &quot;{c.personBName}&quot;, merge the other in</button>
            </form>
            <form action={rejectCandidateAction}>
              <input type="hidden" name="candidateId" value={c.id} />
              <button type="submit">Not a duplicate</button>
            </form>
          </div>
        </div>
      ))}

      {candidates.length === 0 && <p>Nothing pending.</p>}
    </main>
  );
}
