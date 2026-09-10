// Global Search (section 19): candidates, clients, opportunities
// (jobs), and placements in one query per entity type, normalized to one
// result shape. "Contacts" (client_contact) folded into a fifth branch.
// Five separate UNION-free queries, run in parallel, rather than one
// UNION ALL across differently-shaped tables -- simpler to keep correct
// than reconciling five different join shapes into matching UNION
// columns, and the page needs to group results by type anyway.
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export type SearchResult = { type: string; id: string; title: string; subtitle: string; href: string };

export async function globalSearch(query: string): Promise<SearchResult[]> {
  if (!query || query.trim().length < 2) return [];
  const pattern = `%${query.trim()}%`;

  const [candidates, clients, jobs, placements, contacts] = await Promise.all([
    db.execute<{ id: string; primary_name: string; employer_name: string | null }>(sql`
      SELECT p.id, p.primary_name, pe.employer_name
      FROM person p
      LEFT JOIN LATERAL (SELECT employer_name FROM person_employment WHERE person_id = p.id AND is_current = true LIMIT 1) pe ON true
      WHERE p.primary_name ILIKE ${pattern} LIMIT 10
    `),
    db.execute<{ id: string; name: string }>(sql`
      SELECT c.id, b.name FROM client c JOIN brokerage b ON b.id = c.brokerage_id WHERE b.name ILIKE ${pattern} LIMIT 10
    `),
    db.execute<{ id: string; title: string; client_id: string; client_name: string }>(sql`
      SELECT j.id, j.title, j.client_id, b.name AS client_name
      FROM job j JOIN client c ON c.id = j.client_id JOIN brokerage b ON b.id = c.brokerage_id
      WHERE j.title ILIKE ${pattern} LIMIT 10
    `),
    db.execute<{ id: string; person_id: string; person_name: string; job_title: string }>(sql`
      SELECT pl.id, p.id AS person_id, p.primary_name AS person_name, j.title AS job_title
      FROM placement pl
      JOIN engagement e ON e.id = pl.engagement_id
      JOIN person p ON p.id = e.person_id
      JOIN job j ON j.id = e.job_id
      WHERE p.primary_name ILIKE ${pattern} LIMIT 10
    `),
    db.execute<{ id: string; name: string; email: string; client_id: string }>(sql`
      SELECT id, name, email, client_id FROM client_contact WHERE name ILIKE ${pattern} OR email ILIKE ${pattern} LIMIT 10
    `),
  ]);

  return [
    ...candidates.map((c) => ({
      type: "Candidate",
      id: c.id,
      title: c.primary_name,
      subtitle: c.employer_name ?? "",
      href: `/candidates/${c.id}`,
    })),
    ...clients.map((c) => ({ type: "Client", id: c.id, title: c.name, subtitle: "", href: `/clients/${c.id}` })),
    ...jobs.map((j) => ({ type: "Opportunity", id: j.id, title: j.title, subtitle: j.client_name, href: `/clients/${j.client_id}` })),
    ...placements.map((p) => ({
      type: "Placement",
      id: p.id,
      title: p.person_name,
      subtitle: p.job_title,
      href: `/candidates/${p.person_id}`,
    })),
    ...contacts.map((c) => ({ type: "Contact", id: c.id, title: c.name, subtitle: c.email, href: `/clients/${c.client_id}` })),
  ];
}
