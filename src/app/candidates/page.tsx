import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { listCandidates, listFirms } from "@/candidates/queries";
import { createCandidateAction } from "@/candidates/actions";

// Everyone sees every candidate, owner and last-contact included -- that
// visibility is the point (spec 8.2: "The candidate page shows current
// owner, claim basis, expiry, and the full contact ledger... Everyone sees
// everything.").
export default async function CandidatesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/sign-in");

  const [candidates, firms] = await Promise.all([listCandidates(), listFirms()]);

  return (
    <main>
      <h1>Candidates</h1>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Title</th>
            <th>Firm</th>
            <th>Owner</th>
            <th>Last contact</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/candidates/${c.id}`}>{c.fullName}</Link>
                {c.doNotContact && " (DNC)"}
              </td>
              <td>{c.currentTitle ?? "—"}</td>
              <td>{c.firmName ?? "—"}</td>
              <td>{c.ownerEmail ?? "Unclaimed"}</td>
              <td>{c.lastContactAt ? c.lastContactAt.toLocaleDateString() : "Never"}</td>
            </tr>
          ))}
          {candidates.length === 0 && (
            <tr>
              <td colSpan={5}>No candidates yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Add a candidate</h2>
      <form action={createCandidateAction}>
        <div>
          <label>
            Full name <input name="fullName" required />
          </label>
        </div>
        <div>
          <label>
            Current title <input name="currentTitle" />
          </label>
        </div>
        <div>
          <label>
            Current firm (free text) <input name="currentFirmRaw" />
          </label>
        </div>
        <div>
          <label>
            Resolved firm
            <select name="resolvedFirmId" defaultValue="">
              <option value="">— none —</option>
              {firms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.canonicalName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <label>
            LinkedIn URL <input name="linkedinUrl" />
          </label>
        </div>
        <button type="submit">Add candidate</button>
      </form>

      <p>
        <Link href="/firms">Manage firms</Link>
      </p>
    </main>
  );
}
