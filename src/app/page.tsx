import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth/config";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/sign-in");

  // Phase 0 delivered custody and identity. This MVP slice adds the
  // smallest real demo of the collision problem (spec section 1) --
  // candidates, firms, ownership claims, and the contact-ledger cooldown.
  // Everything else (firm resolver, migration, eligibility, outreach,
  // financials) is still ahead -- see README "MVP scope."
  return (
    <main>
      <h1>Palladium Point</h1>
      <p>
        Signed in as {session.user.email} ({session.user.role}).
      </p>
      <nav>
        <ul>
          <li>
            <Link href="/candidates">Candidates</Link>
          </li>
          <li>
            <Link href="/firms">Firms</Link>
          </li>
          {session.user.role === "admin" && (
            <li>
              <Link href="/admin">Admin</Link>
            </li>
          )}
        </ul>
      </nav>
    </main>
  );
}
