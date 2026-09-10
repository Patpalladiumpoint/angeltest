import { inngest } from "../client";
import { crelateAdapter } from "@/adapters/crelate";
import { quickbooksAdapter } from "@/adapters/quickbooks";
import { recordEvent } from "@/db/eventLog";

// Spec 4.3, "self correction": a nightly job that flags divergence and
// emits a single digest of everything that needs a human. Phase 0's slice
// of this: run each adapter's reconcile() and log the result as an event so
// it shows up in the reconciliation dashboard's history, not just the live
// query. The full spec 4.3 job (replay events against state, detect
// logically impossible states) needs the engagement state machine (Phase
// 2) to mean anything -- this is the adapter-drift half only.
export const nightlyReconcile = inngest.createFunction(
  { id: "nightly-reconcile", retries: 1 },
  { cron: "30 7 * * *" }, // after the pulls above
  async ({ step }) => {
    const crelateResult = await step.run("reconcile-crelate", () => crelateAdapter.reconcile());
    const quickbooksResult = await step.run("reconcile-quickbooks", () =>
      quickbooksAdapter.reconcile(),
    );

    await step.run("record-digest", () =>
      recordEvent({
        type: "reconciliation_digest",
        source: "nightly-reconcile",
        payload: { crelateResult, quickbooksResult },
        occurredAt: new Date(),
      }),
    );

    return { crelateResult, quickbooksResult };
  },
);
