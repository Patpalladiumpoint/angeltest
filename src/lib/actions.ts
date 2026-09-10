// Shared return shape for every server action across the app -- lets a
// client component show a specific error message (e.g. "Blocked: a@x.com
// already contacted this candidate...") instead of a generic failure, per
// the working agreement's "prefer explicit failure over silent
// degradation."
export interface ActionResult {
  ok: boolean;
  error?: string;
}
