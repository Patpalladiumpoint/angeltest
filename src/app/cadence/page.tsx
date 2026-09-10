import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { listPendingMergeCandidates } from "@/identity/resolver";
import {
  buildAmDigest,
  amDigestToText,
  buildEodCloseout,
  eodCloseoutToText,
  buildWeekly1on1,
  weekly1on1ToText,
  buildWeeklyRewind,
  weeklyRewindToText,
} from "@/cadence/reports";

const REPORTS = ["am", "eod", "1on1", "rewind"] as const;
type ReportKey = (typeof REPORTS)[number];
const REPORT_LABEL: Record<ReportKey, string> = {
  am: "AM Digest",
  eod: "EOD Closeout",
  "1on1": "Weekly 1:1",
  rewind: "Weekly Rewind",
};

export default async function CadencePage({ searchParams }: { searchParams: { report?: string } }) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");

  const report: ReportKey = (REPORTS as readonly string[]).includes(searchParams.report ?? "") ? (searchParams.report as ReportKey) : "am";
  const [me] = await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, actor.userId)).limit(1);
  const mergeCandidates = await listPendingMergeCandidates();

  let text: string;
  if (report === "am") text = amDigestToText(await buildAmDigest());
  else if (report === "eod") text = eodCloseoutToText(await buildEodCloseout());
  else if (report === "1on1") text = weekly1on1ToText(await buildWeekly1on1());
  else text = weeklyRewindToText(await buildWeeklyRewind());

  return (
    <AppShell
      actor={actor}
      userName={me?.name ?? "You"}
      activeNav="cadence"
      pageTitle="Operating Cadence"
      mergeQueueCount={mergeCandidates.length}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {REPORTS.map((r) => (
            <a key={r} href={`/cadence?report=${r}`} className={report === r ? "btn btn-primary" : "btn"}>
              {REPORT_LABEL[r]}
            </a>
          ))}
        </div>
      }
    >
      <div className="card">
        <div className="panel-head">
          <h2>{REPORT_LABEL[report]}</h2>
          <button id="copy-btn" className="btn" type="button">
            Copy
          </button>
        </div>
        <pre
          id="report-text"
          style={{
            padding: 24,
            margin: 0,
            fontFamily: "IBM Plex Mono, monospace",
            fontSize: 13,
            whiteSpace: "pre-wrap",
            lineHeight: 1.6,
          }}
        >
          {text}
        </pre>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `document.getElementById('copy-btn').addEventListener('click', function() {
            navigator.clipboard.writeText(document.getElementById('report-text').textContent);
            this.textContent = 'Copied';
            setTimeout(() => { this.textContent = 'Copy'; }, 1500);
          });`,
        }}
      />
    </AppShell>
  );
}
