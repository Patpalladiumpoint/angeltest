// Knowledge / Playbooks (section 18). Deliberately plain: title, category,
// body, owner, status, optional client/workflow link. Search via pg_trgm
// (playbook_title_trgm_idx / playbook_body_trgm_idx, migration 0014) --
// same ILIKE-with-a-'%'-default-pattern as src/candidates/queries.ts's
// listCandidates(), not a composed WHERE fragment.
import { sql, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { playbook } from "@/db/schema";

export type PlaybookRow = {
  id: string;
  title: string;
  category: string;
  status: string;
  ownerName: string | null;
  updatedAt: Date;
};

export async function listPlaybooks(searchQuery?: string): Promise<PlaybookRow[]> {
  const likePattern = `%${searchQuery ?? ""}%`;
  const rows = await db.execute<{ id: string; title: string; category: string; status: string; owner_name: string | null; updated_at: Date }>(
    sql`
      SELECT p.id, p.title, p.category::text, p.status::text, u.name AS owner_name, p.updated_at
      FROM playbook p
      LEFT JOIN app_user u ON u.id = p.owner_user_id
      WHERE p.title ILIKE ${likePattern} OR p.body ILIKE ${likePattern}
      ORDER BY p.updated_at DESC
    `,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    status: r.status,
    ownerName: r.owner_name,
    updatedAt: r.updated_at,
  }));
}

export async function getPlaybook(id: string): Promise<{
  id: string;
  title: string;
  category: string;
  body: string;
  status: string;
  linkedClientName: string | null;
} | null> {
  const [row] = await db.execute<{
    id: string;
    title: string;
    category: string;
    body: string;
    status: string;
    linked_client_name: string | null;
  }>(sql`
    SELECT p.id, p.title, p.category::text, p.body, p.status::text, b.name AS linked_client_name
    FROM playbook p
    LEFT JOIN client c ON c.id = p.linked_client_id
    LEFT JOIN brokerage b ON b.id = c.brokerage_id
    WHERE p.id = ${id}
  `);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    body: row.body,
    status: row.status,
    linkedClientName: row.linked_client_name,
  };
}

export async function createPlaybook(
  input: { title: string; category: "sop" | "process" | "template" | "client_preference" | "internal_reference"; body: string; ownerUserId: string },
): Promise<string> {
  const [created] = await db.insert(playbook).values(input).returning({ id: playbook.id });
  return created!.id;
}

export async function updatePlaybookStatus(id: string, status: "draft" | "active" | "archived"): Promise<void> {
  await db.update(playbook).set({ status }).where(eq(playbook.id, id));
}
