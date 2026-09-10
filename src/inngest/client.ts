import { Inngest } from "inngest";

// Durable workflows backbone (spec section 2: "Retries, sleeps, cron, step
// functions with an inspectable log. This is the backbone, not an add on.")
export const inngest = new Inngest({ id: "palladium-os" });
