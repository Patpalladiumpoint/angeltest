import { inngest } from "../client";
import { quickbooksAdapter } from "@/adapters/quickbooks";

// Spec section 8: "Every external call retried with backoff, dead lettered
// after exhaustion, visible in an admin failures view." Inngest gives step
// functions retries/backoff for free at the step level; the adapter itself
// also retries individual QuickBooks calls (src/adapters/retry.ts) since a
// single pull() does many calls and one flaky call shouldn't restart the
// whole step.
export const pullQuickBooksNightly = inngest.createFunction(
  { id: "pull-quickbooks-nightly", retries: 3 },
  { cron: "0 7 * * *" }, // 07:00 UTC daily
  async ({ step }) => {
    const result = await step.run("pull-quickbooks", () => quickbooksAdapter.pull("live"));
    return result;
  },
);

// Manually triggerable version for the admin/reconciliation UI ("run a pull
// now" button) and for local testing without waiting for the cron.
export const pullQuickBooksOnDemand = inngest.createFunction(
  { id: "pull-quickbooks-on-demand", retries: 3 },
  { event: "quickbooks/pull.requested" },
  async ({ event, step }) => {
    const mode = event.data?.mode === "live" ? "live" : "dry";
    const result = await step.run("pull-quickbooks", () => quickbooksAdapter.pull(mode));
    return result;
  },
);
