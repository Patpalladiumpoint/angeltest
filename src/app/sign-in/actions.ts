"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { DEV_SIGNIN_COOKIE } from "@/auth/session";

// Dev-only: see src/auth/session.ts's DEV_SIGNIN_NOTE. Only sets the cookie
// for an email that's an actual seeded app_user -- this is a convenience
// for clicking through the app locally, not a bypass of who can sign in.
export async function devSignIn(formData: FormData): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("dev sign-in is disabled in production");
  }

  const email = String(formData.get("email") ?? "").trim();
  const [user] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, email)).limit(1);
  if (!user) {
    throw new Error(`no app_user seeded with email ${email} -- run npm run db:seed`);
  }

  cookies().set(DEV_SIGNIN_COOKIE, email, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/dashboard");
}
