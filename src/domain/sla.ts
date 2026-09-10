// Deal Control Tower SLA engine (section 6): one shared module for the
// four SLA zones, used identically by the Pipeline, DCT, and Tasks pages
// so their status/overdue logic can never quietly diverge (which is
// exactly the bug already found and fixed once in the pipeline table --
// see isStalled() in src/app/dashboard/page.tsx and its own comment).
//
// Business-day math only (no holiday calendar -- a real holiday list is
// a config-as-code addition for later, not a blocker for the MVP's SLA
// clock to be directionally correct).

export type SlaZone = "submittal_to_feedback" | "yes_to_interview" | "interview_to_feedback" | "offer_to_start";

export const SLA_ZONE_LABEL: Record<SlaZone, string> = {
  submittal_to_feedback: "Submittal → Client Feedback",
  yes_to_interview: "Client Yes → Interview Scheduled",
  interview_to_feedback: "Interview → Feedback",
  offer_to_start: "Offer → Accepted → Start",
};

// Business days. Tunable defaults, not sourced from any client contract --
// see docs/data-model.md for where a per-client override would plug in
// later (client_contract already has guarantee_days/payment_terms_days;
// an sla_days column would be the natural next addition, not built here
// since no client has asked for a different number yet).
export const SLA_TARGET_BUSINESS_DAYS: Record<SlaZone, number> = {
  submittal_to_feedback: 3,
  yes_to_interview: 5,
  interview_to_feedback: 2,
  offer_to_start: 10,
};

export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from);
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

export function slaDueDate(zone: SlaZone, from: Date = new Date()): Date {
  return addBusinessDays(from, SLA_TARGET_BUSINESS_DAYS[zone]);
}

export type SlaStatus = "on_track" | "at_risk" | "overdue" | "done";

const AT_RISK_WINDOW_HOURS = 24;

export function slaStatus(dueAt: Date | null, completedAt: Date | null, now: Date = new Date()): SlaStatus {
  if (completedAt) return "done";
  if (!dueAt) return "on_track";
  const hoursRemaining = (dueAt.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursRemaining < 0) return "overdue";
  if (hoursRemaining <= AT_RISK_WINDOW_HOURS) return "at_risk";
  return "on_track";
}

export const SLA_STATUS_PILL: Record<SlaStatus, string> = {
  on_track: "pill-verdigris",
  at_risk: "pill-amber",
  overdue: "pill-rust",
  done: "pill-slate",
};

export const SLA_STATUS_LABEL: Record<SlaStatus, string> = {
  on_track: "On Track",
  at_risk: "At Risk",
  overdue: "Overdue",
  done: "Done",
};
