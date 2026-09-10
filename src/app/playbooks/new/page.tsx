import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { listPendingMergeCandidates } from "@/identity/resolver";
import { createPlaybookAction } from "../actions";

export default async function NewPlaybookPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const mergeCandidates = await listPendingMergeCandidates();

  return (
    <AppShell actor={actor} userName={me?.name ?? "You"} activeNav="playbooks" pageTitle="New Playbook" mergeQueueCount={mergeCandidates.length}>
      <div className="card" style={{ padding: 24, maxWidth: 640 }}>
        <form action={createPlaybookAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 6 }}>Title</label>
            <input className="field" name="title" required />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 6 }}>Category</label>
            <select className="field" name="category">
              <option value="sop">SOP</option>
              <option value="process">Process</option>
              <option value="template">Template</option>
              <option value="client_preference">Client Preference</option>
              <option value="internal_reference">Internal Reference</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 6 }}>Body</label>
            <textarea className="field" name="body" rows={12} style={{ resize: "vertical", fontFamily: "inherit" }} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
            Create
          </button>
        </form>
      </div>
    </AppShell>
  );
}
