import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth/config";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/sign-in");

  // Phase 0 delivers custody and identity only. The candidate/firm/search
  // record UI lands in Phase 3 -- see spec section 10, build order.
  return (
    <main>
      <h1>Palladium Point</h1>
      <p>Signed in as {session.user.email} ({session.user.role}).</p>
    </main>
  );
}
