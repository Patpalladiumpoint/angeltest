import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { globalSearch } from "@/search/queries";
import { listPendingMergeCandidates } from "@/identity/resolver";

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const query = searchParams.q ?? "";
  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const [results, mergeCandidates] = await Promise.all([globalSearch(query), listPendingMergeCandidates()]);

  return (
    <AppShell actor={actor} userName={me?.name ?? "You"} activeNav="search" pageTitle={`Search: "${query}"`} mergeQueueCount={mergeCandidates.length}>
      <div className="card">
        <div className="panel-head">
          <h2>Results</h2>
          <span className="count mono">{results.length}</span>
        </div>
        {results.length === 0 ? (
          <div className="empty-state">{query.length < 2 ? "Type at least 2 characters to search." : "No matches."}</div>
        ) : (
          results.map((r) => (
            <a className="list-row" href={r.href} key={`${r.type}-${r.id}`} style={{ display: "flex" }}>
              <div className="l-main">
                <span>{r.title}</span>
                <span className="t">{r.subtitle}</span>
              </div>
              <span className="pill pill-slate">{r.type}</span>
            </a>
          ))
        )}
      </div>
    </AppShell>
  );
}
