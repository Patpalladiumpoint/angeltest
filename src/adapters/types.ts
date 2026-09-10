// Common adapter contract (spec section 5): "Each integration is an adapter
// implementing a common interface... pull(), push(), reconcile(), and
// healthCheck()." Adapters live in src/adapters/<system>/.
//
// Hard rule 2: "Never write to an external system without a dry-run mode.
// Every outbound adapter takes mode: 'dry' | 'live'. Dry mode logs the
// intended payload and returns a simulated result." That applies to push();
// pull() also takes a mode so a dry run never writes to our own DB either --
// useful for verifying a query/mapping is right before it touches mirror
// tables.

export type AdapterMode = "dry" | "live";

export type HealthStatus = "ok" | "not_configured" | "unconfirmed" | "error";

export interface HealthCheckResult {
  system: string;
  status: HealthStatus;
  ok: boolean;
  detail: string;
  checkedAt: Date;
}

export interface PullResult {
  system: string;
  mode: AdapterMode;
  recordsFetched: number;
  recordsUpserted: number;
  eventsWritten: number;
  startedAt: Date;
  finishedAt: Date;
  blocked: boolean;
  blockedReason?: string;
  errors: string[];
}

export interface PushResult {
  system: string;
  mode: AdapterMode;
  recordsPushed: number;
  startedAt: Date;
  finishedAt: Date;
  blocked: boolean;
  blockedReason?: string;
  /** Dry mode only: the payload(s) that would have been sent, for review. */
  simulatedPayloads?: unknown[];
  errors: string[];
}

export interface ReconcileResult {
  system: string;
  driftFound: number;
  startedAt: Date;
  finishedAt: Date;
  details: string[];
}

export interface Adapter {
  readonly system: string;
  healthCheck(): Promise<HealthCheckResult>;
  pull(mode: AdapterMode): Promise<PullResult>;
  push(mode: AdapterMode): Promise<PushResult>;
  reconcile(): Promise<ReconcileResult>;
}

/**
 * Thrown (and caught into a blocked PullResult/PushResult, never crashed
 * past the caller) when an adapter cannot act for a reason that is a
 * decision to make, not a bug to fix -- e.g. an open question in spec
 * section 10 that has no safe default. This is the mechanism behind hard
 * rule 1: "If an external API is unavailable or undocumented, stop and
 * report. Do not build a fake adapter and proceed."
 */
export class IntegrationBlockedError extends Error {
  constructor(
    public readonly system: string,
    public readonly reason: string,
  ) {
    super(`${system} integration blocked: ${reason}`);
    this.name = "IntegrationBlockedError";
  }
}
