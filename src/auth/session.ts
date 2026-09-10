import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, userRoleEnum } from "@/db/schema";
import { createSupabaseServerClient } from "./supabase-server";

export type AppUser = typeof users.$inferSelect;
export type UserRole = (typeof userRoleEnum.enumValues)[number];

// Supabase Auth proves *identity* (a real Google account signed in).
// Authorization -- whether that identity is a provisioned Palladium user
// and what role they hold -- is owned entirely by our own users table
// (spec 3.1), matched by email. There is no self-serve signup: an
// unprovisioned Google account authenticates successfully with Supabase
// but getCurrentUser() returns null, same as "not signed in" from the
// app's point of view.
export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser?.email) return null;

  const [appUser] = await db.select().from(users).where(eq(users.email, authUser.email));
  return appUser && appUser.isActive ? appUser : null;
}

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in or not provisioned.");
  return user;
}

export async function requireRole(allowed: UserRole[]): Promise<AppUser> {
  const user = await requireUser();
  if (!allowed.includes(user.role)) {
    throw new Error(`Requires role ${allowed.join(" or ")}; ${user.email} is ${user.role}.`);
  }
  return user;
}
