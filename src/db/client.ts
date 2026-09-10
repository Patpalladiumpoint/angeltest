import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Connects as the palladium_app role (see migrations/0001), which has no
// UPDATE/DELETE on audit_log/event at the database level, and no direct
// SELECT on person_employment.comp / client_contract.fee_percent /
// job.fee_override (see migrations/0007). Application code must never
// widen any of that -- if a feature seems to need it, the design is wrong,
// not the grant.
const queryClient = postgres(connectionString, { max: 10 });

export const db = drizzle(queryClient, { schema });
export { queryClient };

export type Actor = { userId: string; role: "recruiter" | "ops" | "exec" | "admin" };

// First parameter type of db.transaction()'s callback -- pulled from the
// live `db` instance rather than hand-typed against drizzle-orm's internal
// PgTransaction generics, which are verbose to name correctly by hand.
// Exported so functions that accept an already-open transaction (e.g.
// src/audit/log.ts's writeAuditLog, src/events/writer.ts's writeEvent) can
// type their parameter without re-deriving this.
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Section 8's permissions matrix is enforced at the database level, but the
// app connects as one pooled role (palladium_app), so per-request identity
// has to travel with the connection somehow. withActor opens a transaction,
// sets two transaction-scoped session variables the SECURITY DEFINER
// functions and the audit helper read (SET LOCAL, not SET -- scoped to this
// transaction only, never leaks to the next pooled request), and runs the
// callback inside it. Every mutation and every compensation/fee read should
// go through this, not the bare `db` export, once an authenticated actor is
// known. `db` itself stays available for startup/seed/import scripts that
// run before any user session exists.
export async function withActor<T>(
  actor: Actor,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.actor_user_id', ${actor.userId}, true)`);
    await tx.execute(sql`SELECT set_config('app.actor_role', ${actor.role}, true)`);
    return fn(tx);
  });
}
