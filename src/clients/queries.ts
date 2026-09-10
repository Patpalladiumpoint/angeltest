// Client CRM (section 8). Financial summary is deliberately a separate
// function (getClientFinancialSummary) gated by the caller checking
// actor.role, not folded into getClientDetail -- a page that always
// fetches it would always pay the query cost even for a recruiter role
// that the finance functions (migrations/0013) will silently return
// nothing to anyway.
import { sql } from "drizzle-orm";
import { db, withActor, type Actor } from "@/db/client";

export type ClientSummary = {
  clientId: string;
  brokerageName: string;
  tier: string;
  status: string;
  ownerName: string | null;
  openJobs: number;
  activeEngagements: number;
};

export async function listClients(): Promise<ClientSummary[]> {
  const rows = await db.execute<{
    client_id: string;
    brokerage_name: string;
    tier: string;
    status: string;
    owner_name: string | null;
    open_jobs: number;
    active_engagements: number;
  }>(sql`
    SELECT
      c.id AS client_id, b.name AS brokerage_name, c.tier::text, c.status::text, u.name AS owner_name,
      count(DISTINCT j.id) FILTER (WHERE j.status = 'open') AS open_jobs,
      count(DISTINCT e.id) FILTER (WHERE e.status = 'active') AS active_engagements
    FROM client c
    JOIN brokerage b ON b.id = c.brokerage_id
    LEFT JOIN app_user u ON u.id = c.owner_user_id
    LEFT JOIN job j ON j.client_id = c.id
    LEFT JOIN engagement e ON e.job_id = j.id
    GROUP BY c.id, b.name, c.tier, c.status, u.name
    ORDER BY b.name ASC
  `);

  return rows.map((r) => ({
    clientId: r.client_id,
    brokerageName: r.brokerage_name,
    tier: r.tier,
    status: r.status,
    ownerName: r.owner_name,
    openJobs: Number(r.open_jobs),
    activeEngagements: Number(r.active_engagements),
  }));
}

export type ClientDetail = {
  clientId: string;
  brokerageName: string;
  brokerageRank: number | null;
  tier: string;
  status: string;
  ownerName: string | null;
};

export async function getClientDetail(clientId: string): Promise<ClientDetail | null> {
  const [row] = await db.execute<{
    client_id: string;
    brokerage_name: string;
    brokerage_rank: number | null;
    tier: string;
    status: string;
    owner_name: string | null;
  }>(sql`
    SELECT c.id AS client_id, b.name AS brokerage_name, b.rank AS brokerage_rank, c.tier::text, c.status::text, u.name AS owner_name
    FROM client c JOIN brokerage b ON b.id = c.brokerage_id LEFT JOIN app_user u ON u.id = c.owner_user_id
    WHERE c.id = ${clientId}
  `);
  if (!row) return null;
  return {
    clientId: row.client_id,
    brokerageName: row.brokerage_name,
    brokerageRank: row.brokerage_rank,
    tier: row.tier,
    status: row.status,
    ownerName: row.owner_name,
  };
}

export type ClientJob = { jobId: string; title: string; status: string; openEngagements: number };

export async function getClientJobs(clientId: string): Promise<ClientJob[]> {
  const rows = await db.execute<{ job_id: string; title: string; status: string; open_engagements: number }>(sql`
    SELECT j.id AS job_id, j.title, j.status::text,
           count(e.id) FILTER (WHERE e.status = 'active')::int AS open_engagements
    FROM job j LEFT JOIN engagement e ON e.job_id = j.id
    WHERE j.client_id = ${clientId}
    GROUP BY j.id, j.title, j.status
    ORDER BY j.created_at DESC
  `);
  return rows.map((r) => ({ jobId: r.job_id, title: r.title, status: r.status, openEngagements: Number(r.open_engagements) }));
}

export type ClientPlacement = { personName: string; jobTitle: string; startDate: Date | null; status: string };

export async function getClientPlacements(clientId: string): Promise<ClientPlacement[]> {
  const rows = await db.execute<{ person_name: string; job_title: string; start_date: Date | null; status: string }>(sql`
    SELECT p.primary_name AS person_name, j.title AS job_title, pl.start_date, pl.status::text
    FROM placement pl
    JOIN engagement e ON e.id = pl.engagement_id
    JOIN person p ON p.id = e.person_id
    JOIN job j ON j.id = e.job_id
    WHERE j.client_id = ${clientId}
    ORDER BY pl.created_at DESC
  `);
  return rows.map((r) => ({ personName: r.person_name, jobTitle: r.job_title, startDate: r.start_date, status: r.status }));
}

export type ClientContactRow = { id: string; name: string; email: string; isActive: boolean };

export async function getClientContacts(clientId: string): Promise<ClientContactRow[]> {
  const rows = await db.execute<{ id: string; name: string; email: string; is_active: boolean }>(
    sql`SELECT id, name, email, is_active FROM client_contact WHERE client_id = ${clientId} ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, isActive: r.is_active }));
}

// Financial summary -- only meaningful data for ops/exec/admin, and the
// recruiter branch of invoices_for_actor()/commissions_for_actor() (see
// migrations/0013) scopes to that recruiter's OWN placements, not "every
// placement at this client," so a recruiter calling this on a client
// they don't own gets a truthful (small or empty) summary rather than a
// permission error -- consistent with how the DB functions already work.
export type ClientFinancialSummary = { totalInvoiced: number; totalCollected: number; outstanding: number; openInvoices: number };

export async function getClientFinancialSummary(clientId: string, actor: Actor): Promise<ClientFinancialSummary> {
  return withActor(actor, async (tx) => {
    const rows = await tx.execute<{ status: string; amount: number }>(
      sql`SELECT status::text, amount FROM invoices_for_actor() WHERE client_id = ${clientId}`,
    );
    let totalInvoiced = 0;
    let totalCollected = 0;
    let openInvoices = 0;
    for (const r of rows) {
      totalInvoiced += Number(r.amount);
      if (r.status === "paid") totalCollected += Number(r.amount);
      else openInvoices += 1;
    }
    return { totalInvoiced, totalCollected, outstanding: totalInvoiced - totalCollected, openInvoices };
  });
}
