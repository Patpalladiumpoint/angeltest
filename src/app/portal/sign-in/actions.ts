"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { clientContact } from "@/db/schema";
import { PORTAL_SESSION_COOKIE } from "@/portal/session";

// See src/portal/session.ts's SECURITY NOTE -- this is unverified email
// sign-in, acceptable for internal testing, not for real clients.
export async function portalSignIn(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();

  const [contact] = await db
    .select({ id: clientContact.id })
    .from(clientContact)
    .where(and(eq(clientContact.email, email), eq(clientContact.isActive, true)))
    .limit(1);

  if (!contact) {
    throw new Error(`no active client_contact with email ${email}`);
  }

  cookies().set(PORTAL_SESSION_COOKIE, email, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/portal");
}

export async function portalSignOut(): Promise<void> {
  cookies().delete(PORTAL_SESSION_COOKIE);
  redirect("/portal/sign-in");
}
