import { redirect, notFound } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { getPlaybook } from "@/playbooks/queries";
import { listPendingMergeCandidates } from "@/identity/resolver";
import { publishPlaybookAction } from "../actions";

export default async function PlaybookDetailPage({ params }: { params: { id: string } }) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const [pb, mergeCandidates] = await Promise.all([getPlaybook(params.id), listPendingMergeCandidates()]);
  if (!pb) notFound();

  return (
    <AppShell actor={actor} userName={me?.name ?? "You"} activeNav="playbooks" pageTitle={pb.title} mergeQueueCount={mergeCandidates.length}>
      <div className="card">
        <div className="panel-head">
          <h2>
            <span className="pill pill-slate">{pb.category.replace(/_/g, " ")}</span>{" "}
            <span className={`pill ${pb.status === "active" ? "pill-verdigris" : "pill-amber"}`}>{pb.status}</span>
          </h2>
          {pb.status !== "active" && (
            <form action={publishPlaybookAction}>
              <input type="hidden" name="id" value={pb.id} />
              <button type="submit" className="btn btn-primary">
                Publish
              </button>
            </form>
          )}
        </div>
        {pb.linkedClientName && (
          <div style={{ padding: "12px 20px", fontSize: 12.5, color: "var(--ink-muted)", borderBottom: "1px solid var(--line)" }}>
            Linked to client: {pb.linkedClientName}
          </div>
        )}
        <div style={{ padding: 24, whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.6 }}>{pb.body}</div>
      </div>
    </AppShell>
  );
}
