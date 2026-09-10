import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/auth/session";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  // Phase 0 ("Mirror and prove", spec section 7): read-only mirror + the
  // reconciliation dashboard. Everything else -- money spine, engagement
  // state machine, knowledge/AI -- is later phases; see README.
  return (
    <main>
      <h1>Palladium OS</h1>
      <p>
        Signed in as {user.email} ({user.role}).
      </p>
      <nav>
        <ul>
          {(user.role === "ops" || user.role === "exec") && (
            <li>
              <Link href="/reconciliation">Reconciliation</Link>
            </li>
          )}
        </ul>
      </nav>
    </main>
  );
}
