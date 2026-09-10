import { getServerSession, type Session } from "next-auth";
import { authOptions } from "./config";

export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}

// Only two roles exist. This is the entire authorization model for
// admin-only surfaces (kill switch, invoices, commission finalization) --
// see spec section 5, "Do not build a general permissions matrix."
export async function requireAdmin(): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session) throw new UnauthorizedError("Not signed in");
  if (session.user.role !== "admin") throw new ForbiddenError("Admin role required");
  return session;
}

export async function requireUser(): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session) throw new UnauthorizedError("Not signed in");
  return session;
}
