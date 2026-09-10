import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Connects as the palladium_app role (see migrations/0001_init.sql), which
// has no UPDATE/DELETE on audit_log at the database level. Application code
// must never widen that -- if a feature seems to need it, the design is
// wrong, not the grant.
const queryClient = postgres(connectionString, { max: 10 });

export const db = drizzle(queryClient, { schema });
export { queryClient };
