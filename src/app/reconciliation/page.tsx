import { requireRole } from "@/auth/session";
import {
  engagementsWithNoOwner,
  placementsWithNoInvoice,
  placementsWithNoFee,
  invoicesWithNoPlacement,
  duplicateCandidates,
  stageValuesThatDoNotMap,
  integrationHealth,
  recentAdapterFailures,
  driftedSyncRecords,
} from "@/db/reconciliation";

// Spec section 7, Phase 0's exit criterion: "the owner reviews the
// reconciliation report and confirms the discrepancies it found are real."
// Restricted to ops/exec (not recruiter) since it surfaces client/invoice
// data -- see spec 3.3/8 on scoping who sees money-adjacent data, applied
// here even though Phase 0 has no commission data yet.
export default async function ReconciliationPage() {
  await requireRole(["ops", "exec"]);

  const [
    noOwner,
    noInvoice,
    noFee,
    orphanInvoices,
    duplicates,
    stageMapping,
    health,
    failures,
    drift,
  ] = await Promise.all([
    engagementsWithNoOwner(),
    placementsWithNoInvoice(),
    placementsWithNoFee(),
    invoicesWithNoPlacement(),
    duplicateCandidates(),
    stageValuesThatDoNotMap(),
    integrationHealth(),
    recentAdapterFailures(),
    driftedSyncRecords(),
  ]);

  return (
    <main>
      <h1>Reconciliation</h1>
      <p>
        Phase 0: read-only mirror + data-quality report (spec section 7). Nothing on this page
        writes anywhere.
      </p>

      <section>
        <h2>Integration health</h2>
        <ul>
          {health.map((h) => (
            <li key={h.system}>
              <strong>{h.system}</strong>: {h.status} — {h.detail}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Engagements with no owner ({noOwner.length})</h2>
        <ul>
          {noOwner.map((row) => (
            <li key={row.engagementId}>
              {row.candidateName} — {row.jobTitle} ({row.clientName}), stage:{" "}
              {row.currentStage ?? "unset"}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Placements with no invoice ({noInvoice.length})</h2>
        <ul>
          {noInvoice.map((row) => (
            <li key={row.placementId}>
              Placement {row.placementId} (engagement {row.engagementId}), status {row.status}, fee{" "}
              {row.feeAmount ?? "none"}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Placements with no fee ({noFee.length})</h2>
        <ul>
          {noFee.map((row) => (
            <li key={row.placementId}>
              Placement {row.placementId} (engagement {row.engagementId}), status {row.status}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Invoices with no placement ({orphanInvoices.length})</h2>
        <ul>
          {orphanInvoices.map((row) => (
            <li key={row.invoiceId}>
              QuickBooks invoice {row.quickbooksId}: {row.amount} ({row.status})
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Duplicate candidates ({duplicates.length} groups)</h2>
        <ul>
          {duplicates.map((row) => (
            <li key={row.normalized_name + row.normalized_employer}>
              &quot;{row.normalized_name}&quot; at &quot;{row.normalized_employer || "(no employer)"}
              &quot;: {row.candidate_count} records ({row.candidate_ids.join(", ")})
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Stage values that do not map</h2>
        <p>{stageMapping.applicable ? `${stageMapping.unmappedStages.length} unmapped` : "Not yet applicable"}</p>
        <p>{stageMapping.note}</p>
      </section>

      <section>
        <h2>Sync drift ({drift.length})</h2>
        <ul>
          {drift.map((row) => (
            <li key={row.id}>
              {row.system} {row.internalEntity} {row.internalId}: detected {String(row.driftDetectedAt)}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Recent adapter failures / blocks ({failures.length})</h2>
        <ul>
          {failures.map((row) => (
            <li key={row.id}>
              {String(row.occurredAt)} — {row.source} {row.type}: {JSON.stringify(row.payload)}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
