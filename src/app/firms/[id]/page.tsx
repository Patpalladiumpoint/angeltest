import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getFirmDetail } from "@/firms/queries";
import { createEngagementAction } from "@/firms/actions";

export default async function FirmDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/sign-in");

  const detail = await getFirmDetail(params.id);
  if (!detail) notFound();

  const { firm, parent, aliases, events, engagements, candidatesAtFirm } = detail;

  return (
    <main>
      <h1>{firm.canonicalName}</h1>
      <p>
        {firm.firmType} · {firm.status}
        {firm.top100Rank && ` · #${firm.top100Rank} (${firm.top100ListYear})`}
      </p>
      {parent && (
        <p>
          Now part of <Link href={`/firms/${parent.id}`}>{parent.canonicalName}</Link>
        </p>
      )}

      <section>
        <h2>Aliases</h2>
        {aliases.length === 0 ? (
          <p>None on file.</p>
        ) : (
          <ul>
            {aliases.map((a) => (
              <li key={a.id}>
                {a.alias} ({a.aliasType})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>M&amp;A history</h2>
        {events.length === 0 ? (
          <p>None on file.</p>
        ) : (
          <ul>
            {events.map((e) => (
              <li key={e.id}>
                {e.subjectFirmName} — {e.eventType.replace("_", " ")} —{" "}
                {e.counterpartyFirmName ?? "—"}
                {e.effectiveAt && ` (effective ${e.effectiveAt.toLocaleDateString()})`}
                {e.sourceUrl && (
                  <>
                    {" "}
                    <a href={e.sourceUrl} target="_blank" rel="noreferrer">
                      source
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Engagements</h2>
        {engagements.length === 0 ? (
          <p>No engagements on file.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>Off-limits scope</th>
                <th>Started</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {engagements.map((e) => (
                <tr key={e.id}>
                  <td>{e.engagementType}</td>
                  <td>{e.status}</td>
                  <td>{e.offLimitsScope}</td>
                  <td>{e.startedAt.toLocaleDateString()}</td>
                  <td>{e.termsNotes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3>Add an engagement</h3>
        <p>
          Record only for now — nothing yet blocks a claim or a send based on
          off-limits scope (that gate is Phase 5).
        </p>
        <form action={createEngagementAction}>
          <input type="hidden" name="firmId" value={firm.id} />
          <label>
            Type
            <select name="engagementType" defaultValue="retained">
              <option value="retained">Retained</option>
              <option value="contingent">Contingent</option>
              <option value="consulting">Consulting</option>
            </select>
          </label>
          <label>
            Off-limits scope
            <select name="offLimitsScope" defaultValue="firm_wide">
              <option value="firm_wide">Firm-wide</option>
              <option value="division">Division</option>
              <option value="named_individuals">Named individuals</option>
              <option value="none">None</option>
            </select>
          </label>
          <label>
            Notes <input name="termsNotes" />
          </label>
          <button type="submit">Add engagement</button>
        </form>
      </section>

      <section>
        <h2>Candidates at this firm</h2>
        {candidatesAtFirm.length === 0 ? (
          <p>None on file.</p>
        ) : (
          <ul>
            {candidatesAtFirm.map((c) => (
              <li key={c.id}>
                <Link href={`/candidates/${c.id}`}>{c.fullName}</Link>
                {c.currentTitle && ` — ${c.currentTitle}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p>
        <Link href="/firms">Back to firms</Link>
      </p>
    </main>
  );
}
