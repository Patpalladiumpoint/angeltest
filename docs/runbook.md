# Palladium OS runbook

Written as the system is built (spec hard rule 6), not after. Each phase adds
its own section below rather than a separate document. Sections that don't
apply yet say so explicitly instead of being silently missing.

## Phase 0 (current)

### How to check if an integration is working

Visit `/reconciliation` (signed in as `ops` or `exec`). The "Integration
health" section calls each adapter's `healthCheck()` live:

- **`not_configured`** — the relevant env vars aren't set. Not an error;
  expected until credentials exist.
- **`unconfirmed`** (Crelate only) — env vars are set, but spec Open
  Question #1 (plan-tier API access, webhook vs. polling, rate limits) is
  still unresolved, so `pull()`/`push()`/`reconcile()` remain stubs on
  purpose. See `src/adapters/crelate/index.ts`.
- **`error`** — credentials are set but the live call failed. Check the
  `detail` field for the raw error, then "Rotate a credential" below.
- **`ok`** — connected.

### How to run a pull manually (outside the nightly cron)

Send an Inngest event from a shell with access to the app's Inngest
signing key:

```bash
curl -X POST "$INNGEST_EVENT_URL/e/$INNGEST_EVENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "quickbooks/pull.requested", "data": {"mode": "dry"}}'
```

Use `"mode": "dry"` first — it logs the intended queries as an
`adapter_dry_run` event and touches nothing else (hard rule 2). Only pass
`"mode": "live"` once you've confirmed the dry run looks right. Same pattern
for `crelate/pull.requested`, though that adapter is currently a stub (see
above) and will report `blocked` regardless of mode until OQ1 is resolved.

### How to replay a failed sync

1. Check `/reconciliation` → "Recent adapter failures / blocks" for the
   `adapter_pull_failed` or `integration_blocked` event and its payload.
2. If it was a transient failure (network blip, QuickBooks rate limit): just
   re-trigger the pull (see above) — every write is idempotent (`event`'s
   `external_id`, and each mirror table's upsert keyed on its external id),
   so re-running a pull after a partial failure never double-writes.
3. If it was a real error (bad credentials, schema drift in QuickBooks'
   response), fix the root cause first, then re-trigger.
4. The nightly cron (`pullQuickBooksNightly` / `pullCrelateNightly` /
   `nightlyReconcile` in `src/inngest/functions/`) will also pick it back up
   on its own the next night — a manual replay is for "I need this now,"
   not required for eventual consistency.

### How to rotate a credential

1. **QuickBooks**: generate a new refresh token via the OAuth2
   authorization-code flow at developer.intuit.com (refresh tokens rotate on
   use and expire after 100 days of inactivity — Intuit's docs cover the
   exact flow). Update `QUICKBOOKS_REFRESH_TOKEN` in the deploy environment.
   No code change needed; `src/adapters/quickbooks/client.ts` picks it up on
   the next request.
2. **Crelate**: not applicable yet — no credentials are in active use (see
   "unconfirmed" above).
3. **Supabase**: rotate the anon key or service role key from the Supabase
   project dashboard, update `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY`, redeploy.
4. **Google OAuth (SSO)**: rotate the client secret in Google Cloud Console,
   update it inside the Supabase Auth provider config (not an app env var —
   Supabase holds this one).

After rotating anything, check `/reconciliation`'s integration health
section to confirm the new credential actually works before considering the
rotation done.

### What to do when a Crelate sync drifts

Not applicable yet — there is no live Crelate sync (see "unconfirmed"
above). Once Phase 2 implements a real Crelate adapter, this section
becomes: check `/reconciliation` → "Sync drift" for rows where
`sync_record.drift_detected_at` is set, compare the Crelate-side value to
ours, and either accept the Crelate value (re-pull) or push our value back
(only once write-back is implemented and the `sync_record.last_hash` write-
loop guard is in place, per spec section 5).

### How to correct a bad commission entry

Not applicable yet — there are no commission entries. Phase 1 (money spine)
adds this section for real: per spec 3.3, corrections are always a
*reversing entry* referencing the original, never an UPDATE or DELETE.

### How to add a stage / how to add a client contract type

Not applicable yet. Stages live in a declarative config file (spec 4.1)
that ships in Phase 2; client contract types (`client_contract`, spec 3.1)
ship in Phase 1. Both sections will describe "edit this one config file /
add this one migration" once those phases exist — there is deliberately no
per-table free-for-all to document around yet.

## Standing operational notes (all phases)

- **audit_log** and **event** are both append-only at the database role
  level (`REVOKE UPDATE, DELETE`, plus a trigger as defense in depth). If a
  manual correction is ever truly needed on either table, it is a schema
  migration reviewed like any other change — never a manual `UPDATE`/
  `DELETE` from a superuser session. There is no "just this once" path by
  design.
- **Feature flags** live in the `feature_flag` table (`workflow_key`, plus
  an optional `user_id` override). There is no admin UI for them yet in
  Phase 0 (nothing user-facing has shipped that needs gating); toggle via
  SQL until one exists, and log the change in `audit_log` by hand when you
  do (`actor_user_id`, `before`, `after`, `reason`).
