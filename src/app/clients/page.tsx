import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { listClients } from "@/clients/queries";
import { listPendingMergeCandidates } from "@/identity/resolver";

export default async function ClientsPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const [clients, mergeCandidates] = await Promise.all([listClients(), listPendingMergeCandidates()]);

  return (
    <AppShell actor={actor} userName={me?.name ?? "You"} activeNav="clients" pageTitle="Clients" mergeQueueCount={mergeCandidates.length}>
      <div className="card">
        <div className="panel-head">
          <h2>All Clients</h2>
          <span className="count mono">{clients.length}</span>
        </div>
        {clients.length === 0 ? (
          <div className="empty-state">No clients yet.</div>
        ) : (
          <div className="overflow-x">
            <table className="eng-table">
              <thead>
                <tr>
                  <th>Brokerage</th>
                  <th>Tier</th>
                  <th>Owner</th>
                  <th>Open Jobs</th>
                  <th>Active Engagements</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.clientId}>
                    <td><a href={`/clients/${c.clientId}`} style={{ fontWeight: 600 }}>{c.brokerageName}</a></td>
                    <td><span className="pill pill-brass">{c.tier}</span></td>
                    <td>{c.ownerName ?? "unassigned"}</td>
                    <td className="mono">{c.openJobs}</td>
                    <td className="mono">{c.activeEngagements}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
