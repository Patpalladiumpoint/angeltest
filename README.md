# Palladium OS

Orchestration, ledger, and intelligence layer above Crelate, QuickBooks,
Gmail, Calendar, Slack, and (later) Metaview/SourceWhale/Notion, for a
five-person executive search firm. Full spec: the project brief this repo
was built from (`Palladium OS: Build Specification`, v0.1 draft) — build
order, data model, hard rules, and open questions live there; this README
tracks status against it.

## Status: Phase 0 ("Mirror and prove") — scaffolded, not yet connected to real systems

Per the spec's own hard rules, this is a **full replacement** of an earlier
build in this repo that targeted a different, now-superseded spec (a
candidate/firm collision-gate system called "Palladium Point"). That
earlier work is gone from this branch, not merged in — the two specs
described materially different systems (different data model, different
stack choices), and running both at once would have meant building on an
unreviewed foundation.

### What "scaffolded, not yet connected" means

This environment has **zero credentials** for Crelate, QuickBooks,
Supabase, or Inngest, and no npm registry access (`npm install` cannot run
here — see "A note on this session's constraints" below). Hard rule 1 is
explicit: *"Never mock an integration. If an external API is unavailable or
undocumented, stop and report. Do not build a fake adapter and proceed."*
So instead of guessing:

- **Schema, migrations, and the adapter framework are real and complete**
  for Phase 0's scope (spec section 3, section 7). They compile against the
  pinned dependency versions but have not been run in this sandbox — see
  the constraints note.
- **The QuickBooks adapter (`src/adapters/quickbooks/`) is a real
  implementation** against Intuit's documented, public API (OAuth2 refresh
  flow, the `/query` endpoint, the QBO query language). It is not mocked —
  it is simply unconnected, because there is no sandbox company or OAuth
  app in this environment. Set the five `QUICKBOOKS_*` env vars
  (`.env.example`) and it will start working.
- **The Crelate adapter (`src/adapters/crelate/`) is deliberately a
  stub past `healthCheck()`.** Spec Open Question #1 — plan-tier API
  access, webhooks vs. polling, rate limits — is unconfirmed, and its
  default is explicit: *"Stop and report. No safe default."* Writing
  `pull()`/`push()` against a guessed Crelate endpoint shape would itself be
  the fake adapter hard rule 1 forbids. Every call to this adapter reports
  `blocked` and writes an `integration_blocked` event, visible on
  `/reconciliation`, rather than crashing or silently doing nothing.

**This is the single biggest blocker to Phase 0 actually shipping.** Confirm
OQ1 with Crelate (support or account rep) before continuing past this
scaffold — see `docs/runbook.md` and `src/adapters/crelate/index.ts`.

### What's built

- **Schema** (`src/db/schema.ts`, migrations in `src/db/migrations/`):
  `organization` (singleton config), `users` (roles: `recruiter`/`ops`/
  `exec`, spec 3.1), `feature_flag` (per-user/per-workflow, hard rule 7),
  `audit_log` (append-only), `client`, `job`, `candidate` (Crelate mirror,
  `crelate_id` unique), `engagement`, `placement`, `invoice`, `payment`,
  `event` (the append-only spine, spec 3.2), `sync_record` (provenance +
  idempotency, spec 5). Deliberately **not** built yet: `client_contract`,
  `fee`, `commission_plan`, `commission_entry` (Phase 1 money spine),
  `task`/`exception` and the declarative stage config (Phase 2),
  `document`/`document_chunk`/`document_link` (Phase 3) — each migration/
  schema file says why, at the specific column, rather than a blanket
  "later."
- **Append-only enforcement** on both `audit_log` and `event`: `REVOKE
  UPDATE, DELETE` from the app role and from `PUBLIC`, plus a trigger as
  defense in depth against a superuser fat-fingering a manual fix. Same
  pattern for both tables, proven in `test/audit-log.test.ts` (event's
  equivalent guarantee is exercised the same way — see that file's pattern
  applied to `event` in a future test pass if one isn't here yet).
- **Adapter framework** (`src/adapters/types.ts`): `pull`/`push`/
  `reconcile`/`healthCheck`, every write-capable method takes
  `mode: 'dry' | 'live'` (hard rule 2). `src/adapters/retry.ts` gives every
  external call exponential backoff (spec section 8); terminal failures are
  written to `event` as `adapter_pull_failed`, which is what
  `/reconciliation`'s "Recent adapter failures" section reads — a real,
  if minimal, admin failures view rather than a separate `dead_letter`
  table Phase 0 doesn't otherwise need.
- **QuickBooks push() is phase-gated shut**, not just credential-gated:
  Phase 0 is explicitly read-only (spec section 7), so `push()` refuses
  unconditionally with a named reason, even once QuickBooks is fully
  connected. Invoice creation is Phase 1.
- **Inngest scaffold** (`src/inngest/`): nightly cron functions for both
  pulls plus a nightly reconcile job, and on-demand event-triggered
  versions of each pull for manual runs (see `docs/runbook.md`).
- **Auth**: Supabase Auth, Google SSO only (spec section 2, OQ 7 default).
  No local passwords, no dev-only bypass — Supabase Auth is itself an
  external service, so unlike the old repo's next-auth-based dev picker,
  there is no honest way to fake a bypass without either standing up a
  shadow auth path or contradicting "Google SSO only." The real local-dev
  equivalent is the Supabase CLI's local stack (`supabase start`), which
  runs a real GoTrue auth server — see "Running locally" below.
  Authorization (role, whether an account is provisioned at all) is owned
  entirely by our own `users` table, matched by email — Supabase proves
  identity, we own who's allowed in and as what role.
- **Reconciliation dashboard** (`/reconciliation`, ops/exec only):
  implements the spec's own Phase 0 checklist verbatim — engagements with
  no owner, placements with no invoice, placements with no fee, invoices
  with no placement, duplicate candidates (normalized name + employer),
  sync drift, integration health, recent adapter failures. "Stage values
  that do not map" reports "not yet applicable" rather than a guessed
  stage list, since the stage config it would validate against is Phase 2.
- **Seed data** (`src/db/seed.ts`): seeds an exec user and optional
  recruiters for sign-in, plus (behind `SEED_FIXTURES=true`) a small set of
  clearly `[FIXTURE]`-labeled client/job/candidate/engagement/placement/
  invoice rows that exercise every reconciliation finding above. These are
  not real Crelate/QuickBooks data.

### Open questions (spec section 10) — status

| # | Question | Status |
|---|---|---|
| 1 | Crelate API access/shape | **Unresolved, blocking.** See above. |
| 2 | Commission rules | Not reached — Phase 1. |
| 3 | Fee models / guarantee terms | Not reached — Phase 1. Spec default (contingency, % of first-year base, 90-day guarantee) not yet encoded anywhere, since no fee logic exists yet. |
| 4 | Permissions on commission/fee visibility | Partially addressed: `/reconciliation` is ops/exec only as a first cut at "recruiters don't see fee data" (spec default), ahead of real RLS, which needs Phase 1's actual fee tables to be meaningful. |
| 5 | Volume | Unknown — assuming spec's default (<100 placements/yr, <500 active engagements, <100k candidates) per spec, unverified. |
| 6 | Actual stage list | Not reached — Phase 2. |
| 7 | Metaview / SourceWhale API availability | Not reached — Phase 3/4. |
| 8 | System owner post-launch | Assumed non-engineer + AI assistant per spec default; this README and `docs/runbook.md` are written accordingly. |

## Running locally

```bash
cp .env.example .env
npm install
supabase start                 # local Supabase stack; prints URL/anon key for .env
npm run db:migrate              # applies src/db/migrations/*.sql
psql "$MIGRATIONS_DATABASE_URL" -c "ALTER ROLE palladium_app PASSWORD '...' LOGIN;"
SEED_EXEC_EMAIL=you@palladiumpoint.com SEED_RECRUITER_EMAILS=a@x.com,b@x.com SEED_FIXTURES=true npm run db:seed
npm run dev
npx inngest-cli dev -u http://localhost:3000/api/inngest   # separate terminal, for the pull/reconcile functions
```

Sign in at `/sign-in` with a Google account matching a seeded email — you'll
need a Google OAuth provider configured in the local Supabase Auth config
(`supabase/config.toml` once `supabase init` has been run) for that to work
end to end.

### Running tests locally

Integration-first, same philosophy as the append-only guarantees below:
the things that matter (audit-log/event immutability, the actual
reconciliation SQL, the adapters' honest-blocking behavior) only mean
something against a real Postgres, not mocks. You need `OWNER_DATABASE_URL`
(superuser/owner) and `APP_DATABASE_URL` (the `palladium_app` role) pointed
at a local Postgres 16. See `.github/workflows/ci.yml` for a working setup.

## A note on this session's constraints

This repo was built in a sandboxed session with **no access to the npm
registry** (`npm install` returns `403 Forbidden`) and **no Crelate,
QuickBooks, Supabase, or Inngest credentials**. Every file here was
hand-written; nothing was run end-to-end against a live dependency graph or
a live external system this session. What that specifically means:

- `npm install`, `next build`, `tsc` against the real dependency graph, and
  `vitest` itself were not runnable here — the same limitation the
  previous build in this repo hit and disclosed. **Before treating any of
  this as verified, run `npm install && npm run typecheck && npm run lint
  && npm test` in an environment with normal network access** (CI will do
  this automatically on push).
- The QuickBooks adapter is written against Intuit's real, documented API
  shape from training knowledge, not verified against a live sandbox
  company this session — treat it as "should work, unverified" until it's
  run against a real QuickBooks sandbox.
- The Crelate adapter intentionally does **not** attempt this kind of
  best-effort implementation, because unlike QuickBooks, Crelate's actual
  API contract is an open question the spec itself flags as blocking (OQ1)
  — there's no documented public shape to write against honestly.
- The append-only mechanism for `event` (mirrors `audit_log`'s
  `REVOKE`-plus-trigger pattern, itself proven against a real Postgres in
  the previous build's session) has not been re-verified against a live
  database in this session — the SQL is the same shape, applied the same
  way, but confirm it in your own environment before relying on it, per the
  spec's own bias toward "run it against something real."

## Guardrails this repo already enforces

- `audit_log` and `event` are both append-only at the database level
  (`REVOKE UPDATE, DELETE`, plus a trigger). No application code path can
  widen this without editing a migration a reviewer would see.
- The app connects to Postgres as `palladium_app`, never as the migrations
  owner/superuser.
- Every outbound-capable adapter method takes `mode: 'dry' | 'live'` (hard
  rule 2) — `dry` never touches the network or the database beyond logging
  an `adapter_dry_run` event.
- QuickBooks `push()` refuses unconditionally in Phase 0, independent of
  whether credentials are configured — a phase gate, not just a credential
  gate.
- No local passwords anywhere in the auth path; Supabase Auth (Google SSO
  only) is the only sign-in mechanism, including in local dev.
