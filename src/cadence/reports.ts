// Operating Cadence (section 14): AM Digest, EOD Closeout, Weekly 1:1,
// Friday Rewind. Each composes existing, already-verified query modules
// rather than new SQL -- these are reporting views over real data, not a
// new source of truth. Copyable text output (formatToText) is what the
// spec explicitly asks for instead of a Slack integration for MVP.
import { listOpenDeals, listRecentlyClosedDeals } from "@/dct/queries";
import { listInterviewsToday } from "@/interviews/queries";
import { listOverdueTasks } from "@/tasks/queries";
import { slaStatus } from "@/domain/sla";
import { stageLabel } from "@/domain/stages";

export async function buildAmDigest() {
  const [deals, interviewsToday, overdue] = await Promise.all([listOpenDeals(), listInterviewsToday(), listOverdueTasks()]);
  const now = new Date();
  const flagged = deals.filter((d) => slaStatus(d.dueAt, null, now) !== "on_track");
  const needsPat = flagged.filter((d) => slaStatus(d.dueAt, null, now) === "overdue").slice(0, 5);

  return {
    generatedAt: now,
    pipelineCount: deals.length,
    interviewsToday,
    flagged,
    overdueCount: overdue.length,
    needsPat,
  };
}

export function amDigestToText(digest: Awaited<ReturnType<typeof buildAmDigest>>): string {
  const lines = [
    `AM DIGEST — ${digest.generatedAt.toISOString().slice(0, 10)}`,
    "",
    `PIPELINE: ${digest.pipelineCount} active deals`,
    "",
    `TODAY'S INTERVIEWS (${digest.interviewsToday.length})`,
    ...digest.interviewsToday.map((iv) => `  - ${iv.personName} — ${iv.jobTitle} (${iv.clientName}) @ ${iv.scheduledAt?.toISOString().slice(11, 16) ?? "TBD"}`),
    "",
    `FLAGGED / OVERDUE (${digest.overdueCount} tasks overdue)`,
    ...digest.flagged.slice(0, 10).map((d) => `  - ${d.personName} — ${d.jobTitle} (${stageLabel(d.currentStage)})`),
    "",
    `NEEDS PAT`,
    ...(digest.needsPat.length ? digest.needsPat.map((d) => `  - ${d.personName} — ${d.jobTitle}: ${d.taskType}`) : ["  (nothing escalated)"]),
  ];
  return lines.join("\n");
}

export async function buildEodCloseout() {
  const [closed, overdue] = await Promise.all([listRecentlyClosedDeals(1), listOverdueTasks()]);
  return { generatedAt: new Date(), closedToday: closed, openLoops: overdue };
}

export function eodCloseoutToText(closeout: Awaited<ReturnType<typeof buildEodCloseout>>): string {
  const lines = [
    `EOD CLOSEOUT — ${closeout.generatedAt.toISOString().slice(0, 10)}`,
    "",
    `WHAT MOVED / CLOSED TODAY (${closeout.closedToday.length})`,
    ...(closeout.closedToday.length
      ? closeout.closedToday.map((c) => `  - ${c.personName} — ${c.jobTitle} → ${stageLabel(c.currentStage)}`)
      : ["  (nothing closed today)"]),
    "",
    `OPEN LOOPS (${closeout.openLoops.length} overdue)`,
    ...closeout.openLoops.slice(0, 10).map((t) => `  - ${t.type} (${t.entityLabel ?? "—"})`),
    "",
    `QUEUED FOR TOMORROW`,
    "  (see /tasks?view=due_today)",
  ];
  return lines.join("\n");
}

// Weekly 1:1 draft (section 14): "Week at a Glance, Top Observations,
// Needs Pat, DCT Status, Questions, Action Items." A draft to be edited
// before the actual conversation, not a finished artifact -- Questions
// and Action Items are left as fill-in prompts rather than invented text.
export async function buildWeekly1on1() {
  const [deals, overdue, closed] = await Promise.all([listOpenDeals(), listOverdueTasks(), listRecentlyClosedDeals(7)]);
  const now = new Date();
  const atRisk = deals.filter((d) => slaStatus(d.dueAt, null, now) !== "on_track");
  return { generatedAt: now, activeDeals: deals.length, atRisk, closedThisWeek: closed, overdueCount: overdue.length };
}

export function weekly1on1ToText(data: Awaited<ReturnType<typeof buildWeekly1on1>>): string {
  const lines = [
    `WEEKLY 1:1 DRAFT — week ending ${data.generatedAt.toISOString().slice(0, 10)}`,
    "",
    `WEEK AT A GLANCE`,
    `  ${data.activeDeals} active deals · ${data.closedThisWeek.length} closed this week · ${data.overdueCount} tasks overdue`,
    "",
    `TOP OBSERVATIONS`,
    "  (fill in before the 1:1)",
    "",
    `NEEDS PAT`,
    ...(data.atRisk.length ? data.atRisk.slice(0, 5).map((d) => `  - ${d.personName} — ${d.jobTitle} (${stageLabel(d.currentStage)})`) : ["  (nothing escalated)"]),
    "",
    `DCT STATUS`,
    `  ${data.atRisk.length} deals at risk or overdue out of ${data.activeDeals} active`,
    "",
    `QUESTIONS`,
    "  (fill in before the 1:1)",
    "",
    `ACTION ITEMS`,
    "  (fill in during the 1:1)",
  ];
  return lines.join("\n");
}

export async function buildWeeklyRewind() {
  const [closed, deals] = await Promise.all([listRecentlyClosedDeals(7), listOpenDeals()]);
  const now = new Date();
  const stalled = deals.filter((d) => slaStatus(d.dueAt, null, now) === "overdue");
  const starts = closed.filter((c) => c.currentStage === "placed" || c.currentStage === "secured");
  return { generatedAt: now, closedThisWeek: closed, stalled, starts, advanced: deals.length - stalled.length };
}

export function weeklyRewindToText(rewind: Awaited<ReturnType<typeof buildWeeklyRewind>>): string {
  const lines = [
    `WEEKLY REWIND — week ending ${rewind.generatedAt.toISOString().slice(0, 10)}`,
    "",
    `DEALS ADVANCED: ${rewind.advanced}`,
    `DEALS STALLED: ${rewind.stalled.length}`,
    `DEALS CLOSED: ${rewind.closedThisWeek.length}`,
    `STARTS: ${rewind.starts.length}`,
    ...rewind.starts.map((s) => `  - ${s.personName} — ${s.jobTitle} (${s.clientName})`),
    "",
    `NEXT WEEK FLAGS`,
    ...(rewind.stalled.length ? rewind.stalled.slice(0, 10).map((d) => `  - ${d.personName} — ${d.jobTitle}`) : ["  (clean board)"]),
  ];
  return lines.join("\n");
}
