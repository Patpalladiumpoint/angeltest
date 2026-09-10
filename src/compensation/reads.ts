// Section 8: candidate comp data is restricted and audited on read; client
// fee percent is hidden from recruiters entirely. The actual enforcement is
// in Postgres (migrations/0007: column-level REVOKE plus three SECURITY
// DEFINER functions) -- these wrappers exist so application code has one
// obvious way to reach the data rather than being tempted to SELECT the
// column directly (which fails at the database level if anyone tries).
// Must be called inside withActor() so app.actor_role/app.actor_user_id are
// set for the current transaction; these are not meaningful outside one.
import { sql } from "drizzle-orm";
import type { DbTx } from "@/db/client";

export async function readPersonEmploymentComp(tx: DbTx, employmentId: string): Promise<unknown> {
  const [row] = await tx.execute<{ get_person_employment_comp: unknown }>(
    sql`SELECT get_person_employment_comp(${employmentId}::uuid)`,
  );
  return row?.get_person_employment_comp ?? null;
}

// Returns null for a recruiter actor, the real value otherwise -- see the
// SQL function's own comment (migrations/0007) for why this returns null
// rather than throwing.
export async function readClientContractFeePercent(tx: DbTx, contractId: string): Promise<number | null> {
  const [row] = await tx.execute<{ get_client_contract_fee_percent: number | null }>(
    sql`SELECT get_client_contract_fee_percent(${contractId}::uuid)`,
  );
  return row?.get_client_contract_fee_percent ?? null;
}

export async function readJobFeeOverride(tx: DbTx, jobId: string): Promise<number | null> {
  const [row] = await tx.execute<{ get_job_fee_override: number | null }>(
    sql`SELECT get_job_fee_override(${jobId}::uuid)`,
  );
  return row?.get_job_fee_override ?? null;
}
