import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { runDataQualityReport } from "@/dataquality/report";

// Phase 1 week-2 deliverable: the data quality report, on a page a human
// can actually look at. See src/dataquality/report.ts for what each
// section means and why it's shaped this way.
export default async function DashboardPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const report = await runDataQualityReport();

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <h1>Data quality</h1>
      <p>
        <a href="/merge-queue">Merge review queue &rarr;</a>
      </p>

      <Section title={`Unmappable stages (${report.unmappableStages.length})`}>
        {report.unmappableStages.map((r) => (
          <li key={r.externalId}>
            {r.externalId}: &quot;{r.stage}&quot; at {r.occurredAt.toISOString()}
          </li>
        ))}
      </Section>

      <Section title={`Duplicate persons pending review (${report.duplicatePersons.length})`}>
        {report.duplicatePersons.map((r) => (
          <li key={`${r.personAId}-${r.personBId}`}>
            {r.personAName} / {r.personBName} (similarity {r.similarity.toFixed(2)})
          </li>
        ))}
      </Section>

      <Section title={`Engagements with no owner (${report.ownerlessEngagements.length})`}>
        {report.ownerlessEngagements.map((r) => (
          <li key={r.engagementId}>
            {r.personName} &mdash; {r.jobTitle} ({r.stage})
          </li>
        ))}
      </Section>

      <Section title={`Placements with no invoice (${report.placementsWithoutInvoice.length})`}>
        {report.placementsWithoutInvoice.map((r) => (
          <li key={r.placementId}>
            {r.personName} &mdash; started {r.startDate?.toISOString().slice(0, 10) ?? "unknown"}
          </li>
        ))}
      </Section>

      <Section title={`Placements missing a start date (${report.missingStartDates.length})`}>
        {report.missingStartDates.map((r) => (
          <li key={r.placementId}>
            {r.personName} &mdash; status {r.status}
          </li>
        ))}
      </Section>

      <Section title={`Stalled engagements, ranked by days idle x expected fee (${report.stalledEngagements.length})`}>
        {report.stalledEngagements.map((r) => (
          <li key={r.engagementId}>
            {r.personName} &mdash; {r.jobTitle} ({r.stage}), {r.daysIdle}d idle, expected fee{" "}
            {r.expectedFee ? `$${r.expectedFee.toLocaleString()}` : "unset"}, risk score {r.riskScore.toFixed(0)}
          </li>
        ))}
      </Section>

      <Section title={`Document parse failures (${report.parseFailures.length})`}>
        {report.parseFailures.map((r) => (
          <li key={r.documentId}>{r.filename}</li>
        ))}
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 16 }}>{title}</h2>
      <ul>{children}</ul>
    </section>
  );
}
