import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { isOutboundEnabled } from "@/settings/outbound";
import { KillSwitchToggle } from "./KillSwitchToggle";

// "One button in admin" (spec 3.1). Admin-only -- see requireAdmin() on the
// API route this button calls.
export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/sign-in");
  if (session.user.role !== "admin") redirect("/");

  const outboundEnabled = await isOutboundEnabled();

  return (
    <main>
      <h1>Admin</h1>
      <KillSwitchToggle initialEnabled={outboundEnabled} />
    </main>
  );
}
