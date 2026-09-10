# Palladium OS

The ATS and sole record of truth for Palladium Point's active pipeline,
process state, and commission ledger. Built from `PALLADIUM_OS_MVP_SPEC.md`
v3.0 -- an 11-week, phased MVP build. This repo currently implements
**Phase 1: foundation and narrow import** only.

## Why this repo looks like a restart

An earlier build in this repository's history targeted a different, older
brief for the same firm (`candidates`/`firms`/`contact_ledger`/`claims`,
NextAuth + generic S3, no Supabase/Inngest/Anthropic). The v3.0 spec this
build follows redefines the data model (`person`/`brokerage`/`engagement`/
`event`/`commission_entry`) and the approved stack (spec section 2:
Supabase Postgres, Drizzle, Supabase Auth, Supabase Storage, Inngest,
Anthropic API). Per an explicit decision at the start of this session, the
schema and app code were rebuilt from scratch against v3.0 rather than
incrementally migrated -- reusable pieces (the migration runner, the
audit-log lockdown pattern, the restore-drill mechanism, S3-compatible
storage helpers, employer-name normalization) were carried over and
adapted, everything else is new.

## Status: Phase 1 (foundation and narrow import)

Per DECISION 3, the money spine (Phase 2) and ATS core/state machine
(Phase 3) come after this. What's here:

- **Schema and migrations** (`src/db/schema.ts`,
  `src/db/migrations/0001`-`0008`): every table in spec 3.1 (core) and 3.3
  (process) -- `organization`, `app_user`, `person`/`person_identifier`/
  `person_employment`/`person_merge`, `brokerage`/`client`/
  `client_contract`/`job`/`engagement`/`placement`, `event`/`task`/
  `exception`/`audit_log`/`activity_note`, `document_file`. **Not** built:
  the 3.4 money ledger (`fee`/`invoice`/`payment`/`commission_plan_version`/
  `commission_entry`) -- that's Phase 2's money spine, built from the
  `legacy_placement_import` staging table below once the commission engine
  and shadow harness exist (DECISION 6). See the long comment above
  `legacyPlacementImport` in `schema.ts` for the reasoning.
- **Identity resolution** (spec 3.2, `src/identity/`): deterministic match
  on `person_identifier` (email/phone/linkedin/legacy_id, enforced by a
  `UNIQUE(type, normalized_value)` constraint), strong pg_trgm fuzzy match
  (name similarity + matching current employer, threshold and its
  derivation documented in `resolver.ts`) surfaced to a **merge review
  queue** (`person_merge_candidate` -- additive, not one of spec section
  3's named tables; see the migration's comment for why one was needed),
  never auto-merged. `src/identity/merge.ts` implements reversible merges
  with no hard deletes: identifiers/employment/engagements move to the
  survivor unless doing so would collide with something the survivor
  already has (a real process conflict, left in place rather than silently
  resolved), and exactly what moved is recorded so a reversal undoes only
  that.
- **Event spine and audit log** (spec 3.3, `src/events/writer.ts`,
  `src/audit/log.ts`): append-only at the database level (`REVOKE
  UPDATE, DELETE` plus a trigger -- same two-layer pattern for both
  tables), `event.external_id` backs import/webhook idempotency.
- **Section 8 permissions, enforced in Postgres, not application code**:
  `person_employment.comp`, `client_contract.fee_percent`, and
  `job.fee_override` have table-level `SELECT` revoked from the app role
  and column-level `SELECT` re-granted on every other column -- the only
  way to read the sensitive column is through a `SECURITY DEFINER`
  function (`get_person_employment_comp`/`get_client_contract_fee_percent`/
  `get_job_fee_override`, `migrations/0007`) that checks
  `current_setting('app.actor_role')` (set per-transaction by
  `withActor()` in `src/db/client.ts`) and, for compensation reads, writes
  an `audit_log` row. See that migration's comment for why this is
  column-level `REVOKE`+re-`GRANT`, not a naive column-level `REVOKE`
  alone (Postgres table-level grants override column-level revokes --
  this was caught by testing against a real database in this session, see
  below).
- **Section 6 do-not-contact hard stop**: a trigger rejects any `INSERT`
  or owner-changing `UPDATE` on `engagement` for a `do_not_contact = true`
  person, at the database level, not just the service layer.
- **Narrow importer** (DECISION 4, `src/import/`): active engagements and
  their persons/jobs/clients/contracts, plus placements from a bounded
  window with fee/invoice/payment/legacy-commission facts staged for
  Phase 2. Idempotent (keyed on each row's `external_id`), zero external
  dependencies (hand-written CSV parser, no `csv-parse` package -- see "A
  note on this session's constraints" below). **Fixture data, not a real
  export** -- see `src/import/fixtures/README.md` and
  `docs/manual-steps.md` #1.
- **Data quality report** (`src/dataquality/report.ts`, `/dashboard`):
  unmappable stages, duplicate persons pending review, ownerless
  engagements, placements without an invoice, placements missing a start
  date, stalled engagements ranked by a days-idle x expected-fee
  composite score, and document parse failures.
- **The 20-query search acceptance test**, written now per the spec's own
  instruction (`docs/search-acceptance-queries.md`) -- search itself is
  Phase 3.
- **Backup, restore drill, export** (`src/custody/`): `pg_dump`/`pg_restore`
  against an S3-compatible backups bucket (Supabase Storage's S3 protocol,
  kept separate from the Supabase JS storage client used for documents --
  see `src/storage/s3.ts`'s comment), with row-count and orphaned-
  foreign-key assertions, weekly in CI (`.github/workflows/restore-drill.yml`).
  Outcomes are recorded as `event` rows (`backup.completed`/
  `restore_drill.completed`) rather than a settings table -- v3.0's schema
  has no settings singleton, and the event spine is already where
  operational facts belong.
- **Auth**: Supabase Auth, Google SSO only (spec section 2), written to
  the documented `@supabase/ssr` Next.js App Router pattern
  (`src/auth/supabase.ts`, `middleware.ts`,
  `src/app/api/auth/google|callback/route.ts`). A dev-only email sign-in
  path (`src/auth/session.ts`'s `DEV_SIGNIN_NOTE`, gated on
  `NODE_ENV !== "production"`) stands in for it in this sandbox, which has
  no live Supabase project to test real Google OAuth against.
- **Minimal UI**: `/sign-in`, `/dashboard` (data quality report),
  `/merge-queue` (the review queue's merge/reject actions). Deliberately
  plain -- Phase 1's own scope is "foundation," not the ATS core UI
  (that's Phase 3).

### What's deliberately not here

- The money ledger and commission engine (Phase 2).
- The state machine (nine-stage transitions, auto-generated tasks, SLA
  exceptions -- Phase 3). `engagement.current_stage` exists as data the
  importer can write to; nothing automates it yet.
- Search (Phase 3) -- `/candidates`-style browsing doesn't exist yet
  beyond the data quality report and merge queue.
- Resume parsing, the exception engine, email ingest, calendar sync, the
  two AI jobs -- all Phase 3+.

## A note on this session's constraints

This repo was built in a sandboxed session with **no access to the npm
registry** (`npm install` returns `403 Forbidden` -- an organization policy
denial, not a transient failure) or any other package registry, matching
the constraint noted by an earlier build in this repository's history.
Postgres 16 (with `pg_trgm`, `pgcrypto` enabled; `pgvector` is not
installed locally and not needed by anything in this phase -- see
`migrations/0001`'s comment) and the standalone `ts-node`/`tsc` binaries
were available, so verification took two forms:

- **Zero-dependency modules were actually executed.**
  `src/identity/normalize.ts` and `src/import/csv.ts` have no imports
  beyond the language itself, so both were run directly via the globally
  available `ts-node` against real test cases (including the fixture CSV
  file) -- not just reasoned about. `test/identity-resolution.test.ts`
  mirrors exactly what was run.
- **Every SQL-level guarantee was proven against a real, locally-started
  Postgres 16 instance**, not mocked: all eight migrations applied
  cleanly and were then re-applied on top of themselves to confirm
  idempotency (this caught one real bug -- a non-idempotent `ALTER TABLE
  ADD CONSTRAINT`, fixed in `migrations/0003`); `audit_log`/`event`
  reject `UPDATE`/`DELETE` both as the app role (permission denied) and
  as a superuser (trigger); the DNC trigger blocks an `INSERT` on
  `engagement` for a `do_not_contact` person and allows one for anyone
  else; the column-level comp/fee lockdown was tested end-to-end --
  including finding and fixing the real bug where a column-level `REVOKE`
  alone did nothing because the table-level `GRANT` from an earlier
  migration still covered it; the merge-candidate queue's ordered-pair
  `CHECK` plus `UNIQUE` constraint was proven against both a
  wrong-order insert and a reverse-order duplicate; `mergePerson`'s
  conflict-handling logic (a shared identifier, a same-job engagement)
  was proven directly in SQL before the TypeScript was written to match
  it; a full `pg_dump`/`pg_restore` cycle against the complete schema
  (all 20 tables, 34 foreign keys) round-tripped with zero row-count
  mismatches and zero orphaned foreign keys; every query in
  `src/dataquality/report.ts` was run directly and returned the expected
  rows against seeded test data (including the exact Katherine
  Miller/Kathy Miller merge-candidate pair the fuzzy-match threshold is
  documented around).
- **What was not run**: `npm install`, `next build`, `tsc` against the
  real dependency graph, or `vitest` itself -- none of those tools were
  installable without registry access. Every `.ts` file that imports
  `drizzle-orm`, `postgres`, `@supabase/*`, or `@aws-sdk/*` is written to
  compile and run against the pinned versions in `package.json`, and its
  logic was verified via the equivalent raw SQL wherever it touches the
  database (see above), but it has not been machine-verified end-to-end.
  **Before treating Phase 1 as done, run
  `npm install && npm run typecheck && npm run lint && npm test` in an
  environment with normal network access** (this repo's own CI will do
  this automatically on the first push).

## Running locally

```bash
cp .env.example .env
npm install
npm run db:migrate     # applies src/db/migrations/*.sql via MIGRATIONS_DATABASE_URL
psql "$MIGRATIONS_DATABASE_URL" -c "ALTER ROLE palladium_app PASSWORD '...' LOGIN;"
SEED_EXEC_EMAIL=you@palladiumpoint.com npm run db:seed
npm run import:narrow   # loads src/import/fixtures/active_engagements.csv -- see docs/manual-steps.md #1 before using real data
npm run dev
```

Open `/sign-in`. With `NEXT_PUBLIC_SUPABASE_URL` unset (the default outside
a real deploy), use dev sign-in with any seeded email -- see
`src/auth/session.ts`.

### Running tests locally

Integration-first on purpose -- the guarantees that matter here
(audit-log/event immutability, the DNC trigger, the comp/fee column
lockdown, a real restore) only mean something against a real Postgres, not
mocks. You need a local Postgres reachable at `OWNER_DATABASE_URL`
(superuser/owner) and `APP_DATABASE_URL` (the `palladium_app` role -- the
test suite sets its password), an S3-compatible endpoint (MinIO works
locally) for `BACKUPS_BUCKET`, and `pg_dump`/`pg_restore` on `PATH`. See
`.github/workflows/ci.yml` for the exact env vars and a working MinIO +
Postgres service-container setup.

## Guardrails this repo enforces (see "A note on this session's constraints" for how each was verified)

- `audit_log` and `event` are append-only at the database level.
- `person_employment.comp`, `client_contract.fee_percent`, and
  `job.fee_override` are unreadable except through an audited/
  role-checked `SECURITY DEFINER` function.
- A `do_not_contact` person cannot be added to an engagement, enforced by
  a trigger, not just application code.
- Person merges never hard-delete; every merge is reversible and records
  exactly what moved.
- Every event/import row is idempotent on an external id.
- The app connects to Postgres as `palladium_app`, never as the
  migrations owner/superuser.

## Open questions

These are defaults chosen so Phase 1 wasn't blocked, not decisions the
firm has made. Confirm each before Phase 2/3 relies on it:

1. **Real narrow export format** -- `src/import/types.ts`'s
   `NarrowImportRow` is this repo's own CSV contract, not a format any
   real legacy system exports (see `docs/manual-steps.md` #1). Confirm or
   replace before importing real data.
2. **Fuzzy-match threshold (0.55)** -- derived from a handful of measured
   `pg_trgm` scores (see `src/identity/resolver.ts`), not a false-merge
   audit against real duplicate data. Revisit once real data exists
   (kill criterion 13: ">2% false merges on a sampled audit").
3. **Supabase project** -- no live project exists in this environment;
   Auth/Storage code is written to the documented API, unverified
   end-to-end. See `docs/manual-steps.md` #3.
4. **The 20 search-acceptance queries** are this session's best
   construction, not recruiter-dictated -- must be reviewed by an actual
   recruiter before Phase 3's acceptance test runs for real (see
   `docs/search-acceptance-queries.md`).
5. **Data volume** -- unknown; determines whether Postgres full-text
   search (Phase 3) needs tuning beyond the defaults.
