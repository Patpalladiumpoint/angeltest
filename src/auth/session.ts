// Translates a signed-in identity (Supabase Auth in production, or the dev
// email cookie below outside production -- see DEV_SIGNIN_NOTE) into an
// Actor: { userId, role } from app_user, the shape src/db/client.ts's
// withActor() and everything downstream (audit log, comp/fee reads) needs.
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import type { Actor } from "@/db/client";
import { createSupabaseServerClient } from "./supabase";

const DEV_SIGNIN_COOKIE = "palladium_dev_email";

// Dev-only convenience path: sign in as any seeded user by email, no OAuth
// app registration required. Only active outside production (see the
// NODE_ENV guard below and in src/app/sign-in/page.tsx) -- this is not a
// real auth fallback, it exists so this environment (no live Supabase
// project, no network to provision Google OAuth credentials) can be
// clicked through end to end. A real deploy sets SUPABASE_URL/ANON_KEY and
// this path never fires.
export const DEV_SIGNIN_NOTE =
  "Dev sign-in (email only, NODE_ENV !== 'production') stands in for Supabase Auth Google SSO in this sandbox.";

export async function getCurrentActor(): Promise<Actor | null> {
  const email = await resolveEmail();
  if (!email) return null;

  const [user] = await db.select().from(appUser).where(eq(appUser.email, email)).limit(1);
  if (!user || !user.isActive) return null;

  return { userId: user.id, role: user.role };
}

async function resolveEmail(): Promise<string | null> {
  if (process.env.NODE_ENV !== "production") {
    const devEmail = cookies().get(DEV_SIGNIN_COOKIE)?.value;
    if (devEmail) return devEmail;
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null; // no live Supabase project configured

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export { DEV_SIGNIN_COOKIE };
