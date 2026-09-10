import { recordEvent } from "@/db/eventLog";
import type { Adapter, HealthCheckResult, PullResult, PushResult, ReconcileResult } from "../types";
import { IntegrationBlockedError } from "../types";

// Crelate adapter -- DELIBERATELY UNIMPLEMENTED past healthCheck().
//
// Spec hard rule 1: "Never mock an integration. If an external API is
// unavailable or undocumented, stop and report. Do not build a fake adapter
// and proceed." Spec Open Question #1: "Crelate API: access on current
// plan? Webhooks or polling only? Rate limits?" -- blocks Phase 0, default
// if unanswered: "Stop and report. No safe default."
//
// This environment has zero Crelate credentials and no confirmed API
// contract (no plan-tier access confirmation, no webhook-vs-polling
// answer, no rate limits). Writing a pull() against a guessed endpoint
// shape would be exactly the fake adapter hard rule 1 forbids -- it would
// look real, compile, and be wrong in a way nobody could tell apart from
// a real integration until it silently returned nothing or the wrong
// shape in production. So instead: healthCheck() reports the real status
// (not_configured / unconfirmed), and every other method fails loudly and
// immediately, with the exact blocker named, both in the thrown error and
// as an event row so it shows up in the reconciliation dashboard's
// integration health section without anyone having to read logs.
//
// To unblock: get OQ1 answered (plan tier, API docs, webhook vs. polling,
// rate limits), set CRELATE_API_KEY / CRELATE_API_BASE, and replace this
// file's pull()/push()/reconcile() with a real implementation against the
// now-confirmed API -- healthCheck() below already checks for exactly
// those two env vars so it will start reporting "ok" (once network access
// to Crelate is also verified) the moment they're set, as a signal this
// file is ready to be filled in.
const SYSTEM = "crelate";
const BLOCK_REASON =
  "Crelate API access is unconfirmed (spec Open Question #1: plan-tier access, " +
  "webhook vs. polling, rate limits). CRELATE_API_KEY/CRELATE_API_BASE are also " +
  "unset in this environment. Per hard rule 1, no pull/push/reconcile logic has " +
  "been written against a guessed API shape -- confirm OQ1 with Crelate support " +
  "or docs before this adapter is implemented.";

async function reportBlocked(method: string): Promise<void> {
  await recordEvent({
    type: "integration_blocked",
    source: SYSTEM,
    payload: { method, reason: BLOCK_REASON },
    occurredAt: new Date(),
  });
}

export const crelateAdapter: Adapter = {
  system: SYSTEM,

  async healthCheck(): Promise<HealthCheckResult> {
    const configured = Boolean(process.env.CRELATE_API_KEY && process.env.CRELATE_API_BASE);
    return {
      system: SYSTEM,
      status: configured ? "unconfirmed" : "not_configured",
      ok: false,
      detail: configured
        ? "Credentials are set, but the API contract (OQ1) has not been confirmed and this " +
          "adapter's pull/push/reconcile are still stubs -- see src/adapters/crelate/index.ts."
        : "CRELATE_API_KEY / CRELATE_API_BASE are not set, and OQ1 is unresolved. " + BLOCK_REASON,
      checkedAt: new Date(),
    };
  },

  async pull(mode): Promise<PullResult> {
    await reportBlocked("pull");
    const now = new Date();
    return {
      system: SYSTEM,
      mode,
      recordsFetched: 0,
      recordsUpserted: 0,
      eventsWritten: 1,
      startedAt: now,
      finishedAt: now,
      blocked: true,
      blockedReason: BLOCK_REASON,
      errors: [],
    };
  },

  async push(mode): Promise<PushResult> {
    await reportBlocked("push");
    const now = new Date();
    return {
      system: SYSTEM,
      mode,
      recordsPushed: 0,
      startedAt: now,
      finishedAt: now,
      blocked: true,
      blockedReason: BLOCK_REASON,
      errors: [],
    };
  },

  async reconcile(): Promise<ReconcileResult> {
    await reportBlocked("reconcile");
    const now = new Date();
    return {
      system: SYSTEM,
      driftFound: 0,
      startedAt: now,
      finishedAt: now,
      details: [BLOCK_REASON],
    };
  },
};

export function assertCrelateConfirmed(): never {
  throw new IntegrationBlockedError(SYSTEM, BLOCK_REASON);
}
