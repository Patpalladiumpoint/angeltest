import { inngest } from "../client";
import { crelateAdapter } from "@/adapters/crelate";

// Scheduled, but the adapter itself is a deliberate stub (see
// src/adapters/crelate/index.ts) until OQ1 is confirmed -- every run just
// records an integration_blocked event so the blocker stays visible in the
// reconciliation dashboard without anyone needing to remember it exists.
export const pullCrelateNightly = inngest.createFunction(
  { id: "pull-crelate-nightly", retries: 1 },
  { cron: "0 7 * * *" },
  async ({ step }) => {
    const result = await step.run("pull-crelate", () => crelateAdapter.pull("live"));
    return result;
  },
);

export const pullCrelateOnDemand = inngest.createFunction(
  { id: "pull-crelate-on-demand", retries: 1 },
  { event: "crelate/pull.requested" },
  async ({ event, step }) => {
    const mode = event.data?.mode === "live" ? "live" : "dry";
    const result = await step.run("pull-crelate", () => crelateAdapter.pull(mode));
    return result;
  },
);
