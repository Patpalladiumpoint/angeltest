// Canonical stage map. The database enum (engagement_stage, migrations
// 0003 + 0010) stays exactly as it is -- nothing renamed, nothing rebuilt
// -- this module is the one place the product brief's fuller recruiting
// vocabulary (Sourced, Outreach, Interested, Prescreen, Active, Submittal,
// Sendout, Follow-Up, Offer, Pending Start, Start/Secured, Not Interested,
// Candidate/Client/Palladium Reject, Future Prospect, Keep in Touch,
// Nurture) maps onto the 20 stored values. Every page renders through
// this map instead of hand-formatting stage strings, so the display
// vocabulary can evolve without another migration.
import type { engagementStageEnum } from "@/db/schema";

export type EngagementStage = (typeof engagementStageEnum.enumValues)[number];

export type StageGroup = "pipeline" | "closed_won" | "closed_lost" | "nurture";

export const STAGE_INFO: Record<EngagementStage, { label: string; group: StageGroup; order: number }> = {
  sourced: { label: "Sourced", group: "pipeline", order: 1 },
  outreach: { label: "Outreach", group: "pipeline", order: 2 },
  engaged: { label: "Active", group: "pipeline", order: 3 }, // "Interested" in the brief's vocabulary
  qualified: { label: "Prescreened", group: "pipeline", order: 4 },
  submitted: { label: "Submittal", group: "pipeline", order: 5 },
  client_process: { label: "Interviewing", group: "pipeline", order: 6 }, // sendout/follow-up rounds are `interview` rows, not stages
  offer: { label: "Offer", group: "pipeline", order: 7 },
  pending_start: { label: "Pending Start", group: "pipeline", order: 8 },
  placed: { label: "Started", group: "closed_won", order: 9 },
  secured: { label: "Secured", group: "closed_won", order: 10 },
  candidate_declined: { label: "Candidate Declined", group: "closed_lost", order: 20 },
  client_rejected: { label: "Client Reject", group: "closed_lost", order: 21 },
  palladium_reject: { label: "Palladium Reject", group: "closed_lost", order: 22 },
  withdrawn: { label: "Withdrawn", group: "closed_lost", order: 23 },
  on_hold: { label: "On Hold", group: "pipeline", order: 24 },
  fell_off: { label: "Fell Off", group: "closed_lost", order: 25 },
  not_interested: { label: "Not Interested", group: "nurture", order: 30 },
  future_prospect: { label: "Future Prospect", group: "nurture", order: 31 },
  keep_in_touch: { label: "Keep in Touch", group: "nurture", order: 32 },
  nurture: { label: "Nurture", group: "nurture", order: 33 },
};

export function stageLabel(stage: string): string {
  return STAGE_INFO[stage as EngagementStage]?.label ?? stage.replace(/_/g, " ");
}

// "Sitting a long time is fine here" -- the pipeline table's own bug fix
// (isStalled in src/app/dashboard/page.tsx) and the DCT's "Recently
// Closed" view both key off this same set. Kept in one place so the two
// screens can never disagree about what counts as terminal again.
export const TERMINAL_STAGES: ReadonlySet<EngagementStage> = new Set(["placed", "secured"]);
export const CLOSED_LOST_STAGES: ReadonlySet<EngagementStage> = new Set([
  "candidate_declined",
  "client_rejected",
  "palladium_reject",
  "withdrawn",
  "fell_off",
]);
export const NURTURE_STAGES: ReadonlySet<EngagementStage> = new Set([
  "not_interested",
  "future_prospect",
  "keep_in_touch",
  "nurture",
]);
export const OPEN_STAGES: EngagementStage[] = (Object.keys(STAGE_INFO) as EngagementStage[]).filter(
  (s) => !TERMINAL_STAGES.has(s) && !CLOSED_LOST_STAGES.has(s) && !NURTURE_STAGES.has(s),
);

// Mirrored in Postgres as is_open_engagement_stage() (migration 0018) for
// the raw-SQL queries (Pipeline KPIs, DCT, Data Quality) that can't import
// this TS module -- keep both lists in sync by hand if a stage is ever
// added or reclassified.

// Client-safe stage mapping (section 15). Collapses the internal 20-value
// vocabulary down to six client-facing states, and -- the actually load-
// bearing part -- has no entry at all for sourced/outreach/engaged/
// qualified, so a client-visible funnel position can never be computed
// for a candidate who hasn't reached 'submitted' yet. src/portal/queries.ts
// enforces this the same way (a separate, independent check), so a bug in
// either one alone doesn't leak early-pipeline visibility.
export const CLIENT_STAGE_MAP: Partial<Record<EngagementStage, string>> = {
  submitted: "Presented",
  client_process: "Interviewing",
  offer: "Final Stage",
  pending_start: "Final Stage",
  placed: "Secured",
  secured: "Secured",
  candidate_declined: "Closed",
  client_rejected: "Closed",
  fell_off: "Closed",
};

export function clientStageLabel(stage: string): string | null {
  return CLIENT_STAGE_MAP[stage as EngagementStage] ?? null;
}
