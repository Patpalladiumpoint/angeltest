import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getCandidateDetail, findPossibleDuplicates, listFirms } from "@/candidates/queries";
import { resolveFirm, requiresManualConfirmation } from "@/firms/resolver";
import { ClaimButton } from "./ClaimButton";
import { LogContactForm } from "./LogContactForm";
import { LogActivityForm } from "./LogActivityForm";
import { CandidateEditForm } from "./CandidateEditForm";
import { MergeForm } from "./MergeForm";
import { UnmergeButton } from "./UnmergeButton";
import { DocumentUploadForm } from "./DocumentUploadForm";

export default async function CandidateDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/sign-in");

  const detail = await getCandidateDetail(params.id);
  if (!detail) notFound();

  const { candidate, mergedInto, activeClaim, timeline, documents } = detail;

  if (mergedInto) {
    return (
      <main>
        <h1>{candidate.fullName}</h1>
        <p>
          This record was merged into{" "}
          <Link href={`/candidates/${mergedInto.id}`}>{mergedInto.fullName}</Link>. Its history is
          preserved and folded into that record's timeline.
        </p>
        <UnmergeButton candidateId={candidate.id} />
      </main>
    );
  }

  const [firms, duplicates] = await Promise.all([
    listFirms(),
    findPossibleDuplicates(candidate.id, candidate.fullName),
  ]);

  // Live suggestion, not stored: if the resolver couldn't auto-apply a firm
  // (spec 8.1's 0.95 confidence bar), show what it *would* suggest so a
  // human can confirm it with one click via the edit form, rather than
  // guessing why the firm field is blank.
  const suggestion =
    !candidate.resolvedFirmId && candidate.currentFirmRaw
      ? await resolveFirm(candidate.currentFirmRaw)
      : null;
  const suggestedFirmName =
    suggestion?.status === "resolved" && requiresManualConfirmation(suggestion) ? suggestion.matchedName : null;

  return (
    <main>
      <h1>{candidate.fullName}</h1>
      {candidate.preferredName && <p>Goes by {candidate.preferredName}</p>}
      <p>
        {candidate.currentTitle ?? "—"} at {candidate.firmName ?? candidate.currentFirmRaw ?? "—"}
        {candidate.firmName && candidate.firmResolutionMethod && (
          <> ({candidate.firmResolutionMethod} match{candidate.firmResolutionConfidence != null && `, ${Math.round(candidate.firmResolutionConfidence * 100)}%`})</>
        )}
      </p>
      {suggestedFirmName && (
        <p>
          Possible firm match: <strong>{suggestedFirmName}</strong> ({suggestion?.method}, needs
          confirmation — pick it in Edit below to confirm).
        </p>
      )}
      {candidate.specialty && <p>Specialty: {candidate.specialty}</p>}
      {candidate.location && <p>Location: {candidate.location}</p>}
      {candidate.seniority && <p>Seniority: {candidate.seniority}</p>}
      {candidate.summary && <p>{candidate.summary}</p>}
      {candidate.linkedinUrl && (
        <p>
          <a href={candidate.linkedinUrl} target="_blank" rel="noreferrer">
            LinkedIn
          </a>
        </p>
      )}
      {candidate.doNotContact && (
        <p>
          <strong>Do not contact.</strong> {candidate.dncReason}
        </p>
      )}

      <CandidateEditForm candidate={candidate} firms={firms} />

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
        <h2>Log other activity</h2>
        <p>For recording something that already happened — doesn't go through the collision gate.</p>
        <LogActivityForm candidateId={candidate.id} />
      </section>

      <section>
        <h2>Documents</h2>
        {documents.length === 0 ? (
          <p>No documents uploaded.</p>
        ) : (
          <ul>
            {documents.map((d) => (
              <li key={d.id}>
                <a href={`/api/documents/${d.id}/download`}>{d.filename}</a> ({d.docType},{" "}
                {(d.sizeBytes / 1024).toFixed(0)} KB, parse: {d.parseStatus})
              </li>
            ))}
          </ul>
        )}
        <DocumentUploadForm candidateId={candidate.id} />
      </section>

      <section>
        <h2>Timeline</h2>
        {timeline.length === 0 ? (
          <p>Nothing logged yet.</p>
        ) : (
          <ul>
            {timeline.map((entry) => (
              <li key={entry.id}>
                {entry.occurredAt.toLocaleString()} — {entry.activityType}
                {entry.direction && ` (${entry.direction})`} — {entry.userEmail ?? "system"}
                {entry.subject && <> — {entry.subject}</>}
                {entry.body && <div>{entry.body}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Merge</h2>
        <MergeForm candidateId={candidate.id} duplicates={duplicates} />
      </section>
    </main>
  );
}
