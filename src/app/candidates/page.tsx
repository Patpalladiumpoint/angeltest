import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { listCandidates, listCandidateFacets, listFirms } from "@/candidates/queries";
import { createCandidateAction } from "@/candidates/actions";

// Full-text (spec section 4: "Postgres full-text search (tsvector)") plus
// faceted filtering by specialty/location (spec Phase 3: "full-text and
// faceted search"). Filters are plain URL search params, not client state
// -- a search is a URL you can bookmark or hand to a teammate, matching how
// the rest of this app avoids client-side state where a server round trip
// is cheap enough (five users, moderate volume -- see spec section 4,
// "Keep it boring").
export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: { q?: string; specialty?: string; location?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/sign-in");

  const filters = {
    query: searchParams.q,
    specialty: searchParams.specialty,
    location: searchParams.location,
  };

  const [candidateList, facets, firms] = await Promise.all([
    listCandidates(filters),
    listCandidateFacets(),
    listFirms(),
  ]);

  const hasFilters = Boolean(filters.query || filters.specialty || filters.location);

  return (
    <main>
      <h1>Candidates</h1>

      <form>
        <input type="search" name="q" placeholder="Search name, title, specialty..." defaultValue={filters.query ?? ""} />
        <select name="specialty" defaultValue={filters.specialty ?? ""}>
          <option value="">All specialties</option>
          {facets.specialties.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="location" defaultValue={filters.location ?? ""}>
          <option value="">All locations</option>
          {facets.locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <button type="submit">Search</button>
        {hasFilters && <Link href="/candidates">Clear</Link>}
      </form>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Title</th>
            <th>Firm</th>
            <th>Specialty</th>
            <th>Location</th>
            <th>Owner</th>
            <th>Last contact</th>
          </tr>
        </thead>
        <tbody>
          {candidateList.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/candidates/${c.id}`}>{c.fullName}</Link>
                {c.doNotContact && " (DNC)"}
              </td>
              <td>{c.currentTitle ?? "—"}</td>
              <td>{c.firmName ?? "—"}</td>
              <td>{c.specialty ?? "—"}</td>
              <td>{c.location ?? "—"}</td>
              <td>{c.ownerEmail ?? "Unclaimed"}</td>
              <td>{c.lastContactAt ? c.lastContactAt.toLocaleDateString() : "Never"}</td>
            </tr>
          ))}
          {candidateList.length === 0 && (
            <tr>
              <td colSpan={7}>{hasFilters ? "No candidates match this search." : "No candidates yet."}</td>
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
            Current firm (free text — the resolver will try to match it automatically)
            <input name="currentFirmRaw" />
          </label>
        </div>
        <div>
          <label>
            Resolved firm (optional — overrides the resolver)
            <select name="resolvedFirmId" defaultValue="">
              <option value="">— let the resolver decide —</option>
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
            Specialty <input name="specialty" />
          </label>
        </div>
        <div>
          <label>
            Location <input name="location" />
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
