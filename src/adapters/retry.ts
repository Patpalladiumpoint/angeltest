// Spec section 8: "Every external call retried with backoff, dead lettered
// after exhaustion, visible in an admin failures view." The retry/backoff
// mechanism is generic here; "dead lettered... visible" is implemented by
// the caller writing a terminal-failure event to the event log (spec 3.2's
// spine is also the natural admin-failures record -- see
// src/db/eventLog.ts and the reconciliation dashboard's "recent adapter
// failures" section), rather than a separate dead_letter table Phase 0
// doesn't otherwise need.

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryOptions = {
  attempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 15_000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = DEFAULT_RETRY,
  onAttemptFailed?: (attempt: number, err: unknown) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      onAttemptFailed?.(attempt, err);
      if (attempt === opts.attempts) break;
      const delay = Math.min(opts.baseDelayMs * 2 ** (attempt - 1), opts.maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
