import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getCandidateDetail } from "@/candidates/queries";
import { ClaimButton } from "./ClaimButton";
import { LogContactForm } from "./LogContactForm";

export default async function CandidateDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/sign-in");

  const detail = await getCandidateDetail(params.id);
  if (!detail) notFound();

  const { candidate, activeClaim, contactHistory } = detail;

  return (
    <main>
      <h1>{candidate.fullName}</h1>
      <p>
        {candidate.currentTitle ?? "—"} at {candidate.firmName ?? candidate.currentFirmRaw ?? "—"}
      </p>
      {candidate.linkedinUrl && (
        <p>
          <a href={candidate.linkedinUrl} target="_blank" rel="noreferrer">
            LinkedIn
          </a>
        </p>
      )}
      {candidate.doNotContact && <p><strong>Do not contact.</strong></p>}

      <section>
        <h2>Ownership</h2>
        {activeClaim ? (
          <p>
            Claimed by {activeClaim.ownerName} ({activeClaim.ownerEmail}) on{" "}
            {activeClaim.claimedAt.toLocaleDateString()} — basis: {activeClaim.claimBasis}
          </p>
        ) : (
          <>
            <p>Unclaimed.</p>
            <ClaimButton candidateId={candidate.id} />
          </>
        )}
      </section>

      <section>
        <h2>Log contact</h2>
        <p>
          Blocked if anyone contacted this candidate in the last 90 days — the collision gate
          (spec 8.2) applies regardless of who owns the claim.
        </p>
        <LogContactForm candidateId={candidate.id} disabled={candidate.doNotContact} />
      </section>

      <section>
        <h2>Contact history</h2>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>By</th>
              <th>Channel</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {contactHistory.map((c) => (
              <tr key={c.id}>
                <td>{c.occurredAt.toLocaleString()}</td>
                <td>{c.userEmail}</td>
                <td>{c.channel}</td>
                <td>{c.outcome ?? "—"}</td>
              </tr>
            ))}
            {contactHistory.length === 0 && (
              <tr>
                <td colSpan={4}>No contact logged yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
