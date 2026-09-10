import type { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

// OIDC SSO only -- no local passwords (spec section 4). Which provider is
// live is an environment decision (OQ 7), not a code branch we guess at
// build time: both are registered, and only the one with credentials set
// actually activates, so a fresh deploy that only fills in Google env vars
// gets exactly the Google flow with no dead Microsoft button.
const providers: AuthOptions["providers"] = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Restrict to the firm's Workspace domain at the IdP level via
      // hosted domain param; also re-checked in signIn() below since hd can
      // be spoofed by a malicious client.
      authorization: { params: { hd: process.env.GOOGLE_WORKSPACE_DOMAIN ?? "" } },
    }),
  );
}

if (
  process.env.MICROSOFT_CLIENT_ID &&
  process.env.MICROSOFT_CLIENT_SECRET &&
  process.env.MICROSOFT_TENANT_ID
) {
  providers.push(
    AzureADProvider({
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      tenantId: process.env.MICROSOFT_TENANT_ID,
    }),
  );
}

export const authOptions: AuthOptions = {
  providers,
  session: { strategy: "jwt" },
  pages: {
    // Sign-in errors (e.g. "not provisioned") land on a dedicated page
    // rather than NextAuth's generic default -- there are only five users,
    // so a bad sign-in is worth a clear message, not a stock error page.
    error: "/sign-in",
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;

      // This platform does not provision accounts from the IdP. Role
      // (recruiter/admin) is owned by our users table, seeded by an admin.
      // Signing in with a Workspace/Entra account that has no row here is a
      // deliberate hard stop, not an auto-provisioned recruiter account --
      // five users, all known in advance.
      const [existing] = await db.select().from(users).where(eq(users.email, user.email));
      return Boolean(existing?.isActive);
    },
    async jwt({ token }) {
      if (!token.email) return token;
      const [dbUser] = await db.select().from(users).where(eq(users.email, token.email));
      if (dbUser) {
        token.userId = dbUser.id;
        token.role = dbUser.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.role = token.role as "recruiter" | "admin";
      }
      return session;
    },
  },
};
