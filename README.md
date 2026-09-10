# Palladium Point

Candidate, firm, engagement, pipeline, and outreach system of record for a
five-recruiter executive search desk covering the Business Insurance Top 100
Brokers. Full spec: see the project brief this repo was built from (build
order, data model, and guardrails).

## Status: Phase 0 (Foundation and custody) + an MVP slice + Phase 1 (Firm graph)

Per the spec's build order, phases ship in sequence and each is
independently demoable. **This repo currently implements Phase 0 only:**

- Repo scaffold: Next.js (App Router) + TypeScript, Drizzle ORM, Postgres.
- SSO (OIDC) with two roles (`recruiter`, `admin`) — no local passwords.
- Append-only `audit_log`, enforced at the database role level (`REVOKE`)
  plus a trigger as defense in depth. Verified against a real Postgres, not
  mocked — see `test/audit-log.test.ts`.
- Global kill switch (`system_settings.outbound_enabled`) with an admin API
  route and a one-button admin page.
- S3-compatible object storage client, used by backup/export today and by
  documents (Phase 3) later.
- Nightly logical backup script (`npm run backup:run`) to a separate
  backups bucket, with 35-day retention.
- Restore drill (`npm run backup:restore-drill`): restores the latest backup
  into a scratch database and asserts row counts and referential integrity
  match the source. Wired into CI to run on every push (against a
  same-run backup) and weekly against the real production backup
  (`.github/workflows/restore-drill.yml`).
- On-demand full export (`npm run export:run`): every table to JSONL plus a
  manifest, one command.
- CI: typecheck, lint, test on every push/PR.

Everything past Phase 0 (firm graph, migration, candidate/search records,
ownership, email, research, drafting, review, send, LinkedIn, cadences,
reporting) was **not built yet at that point**. Building it before custody
was solid would have meant building business-critical infrastructure on an
unverified foundation — the spec calls this out explicitly ("Do not skip
the custody work. It is cheap now and expensive later.").

## MVP slice: candidates, firms, and the collision gate

On top of Phase 0, this repo also has a deliberately small, real, clickable
slice: **candidates, firms, ownership claims, and the contact-ledger
cooldown** — the smallest cut that demonstrates the firm's #1 stated problem
(collision: two recruiters touching the same candidate) with **no LLM, no
email integration, no firm resolver**. The spec calls this combination
"fastest real value in the build" (Phase 5) precisely because it needs none
of that.

What it does:

- `/candidates` — list every candidate (owner and last-contact visible to
  everyone, on purpose — spec 5: "Opacity is what created the collision
  problem"), and a quick-add form.
- `/candidates/[id]` — claim a candidate, log a contact, see full contact
  history.
- `/firms` — a minimal firm list/add (no aliases, no fuzzy resolver — see
  "What's stubbed" below).
- **The actual guardrails, not just UI:**
  - One active claim per candidate, enforced by a partial unique index —
    proven under a real concurrent-insert race in this session (two
    simultaneous claims on the same candidate; exactly one wins, the other
    gets `23505 duplicate key value`).
  - The 90-day global contact cooldown (spec 8.2: "no candidate receives
    outbound from anyone within 90 days of the last outbound, even the same
    owner on a different search") is checked at the moment of logging
    contact, names who blocked it and when, and writes a
    `collision_blocked` audit row (feeds the "Collision events blocked"
    report metric in spec section 9, once reporting exists).
  - First-touch auto-claim on the first logged contact, same
    partial-unique-index guarantee against the same race.
  - `do_not_contact` hard-stops logging.

**What's stubbed, on purpose, for "quick":**

- No firm resolver (Phase 1) — firms are hand-entered, no aliases/fuzzy
  matching/M&A chain.
- No off-limits/eligibility engine (`engagements`, `firm_restrictions`) —
  the collision gate is the *global* cooldown only, not the full spec 8.1
  eligibility pipeline.
- No claim expiry/exclusivity window, no override flow — claims just sit
  `active` until manually contested.
- No migration, no email, no outreach/drafting/send, no financials.

None of this is a shortcut on the guardrails that do exist — the parts that
are built (append-only audit log, one-active-claim, the cooldown gate) are
real database-level guarantees, verified against a running Postgres, not
mocked or faked for the demo.

### Trying it locally

```bash
npm install
npm run db:migrate
SEED_ADMIN_EMAIL=you@palladiumpoint.com SEED_RECRUITER_EMAILS=a@x.com,b@x.com npm run db:seed
npm run dev
```

Open `/sign-in` and use the **dev sign-in** box (email only, no password) to
sign in as any seeded user — this path only exists when
`NODE_ENV !== "production"` (see `src/auth/config.ts`) and is not a
real-auth fallback, just a way to click through the app without registering
a Google/Microsoft OAuth app first. To see the collision gate fire: sign in
as `a@x.com`, add a candidate, log a contact; sign out, sign in as `b@x.com`,
try to log a contact on the same candidate within 90 days — it's blocked and
names `a@x.com` and the timestamp.

## Phase 1: firm graph and resolver

The spec calls this phase out specifically: "This phase is where the project
succeeds or fails quietly. Do not rush it." It's implemented per spec 7.3:

- `firms` (expanded past the MVP's trimmed version), `firm_aliases`,
  `firm_events` — canonical names, DBAs/former names/abbreviations, and M&A
  history with source URLs and dates.
- `src/firms/normalize.ts` — the mechanical normalization step (lowercase,
  strip punctuation and legal suffixes, expand a small abbreviation set,
  strip "dba" prefixes). Zero dependencies, so it's the one piece of this
  whole repo actually **executed** in this sandbox (via the globally
  available `ts-node`, since `npm install` wasn't possible — see below),
  not just reasoned about.
- `src/firms/resolver.ts` — the three-tier resolver (`resolveFirm`): exact
  match on normalized canonical name (confidence 1.0) → exact match on a
  normalized alias (0.95) → `pg_trgm` fuzzy match above a 0.85 similarity
  floor (confidence = score) → `needs_manual_review`. Plus
  `requiresManualConfirmation()`, the separate, stricter spec 8.1 gate
  ("below 0.95 confidence → manual review, hard stop") that a successful
  fuzzy match still has to clear before it's usable for eligibility or
  outreach — and `walkAcquisitionChain()`, which follows `firm_events` to
  a firm's current owner and applies the OQ 2 eligibility default
  (acquired by a Top 100 firm → stays eligible; acquired by a non-list firm
  → conditional; eligible throughout the announced→effective+12mo
  transition window regardless).
- `src/firms/seed-data/top100-2026.ts` — versioned seed data (28 real firms).
  **Read the provenance note at the top of that file before trusting it for
  anything real**: businessinsurance.com and the Alliant-hosted Top 100 PDF
  were both blocked by this session's network policy, so this was built from
  live web search snippets, not the actual subscription list. Ranks/years
  marked non-null came from a search result naming both explicitly; the rest
  are real, well-known firms with no specific rank verified this session.
  The three acquisition events (Woodruff Sawyer → Gallagher, The Horton
  Group → Marsh & McLennan, Accession Risk Management Group → Brown & Brown)
  **are** fully verified against live sources, with real dates and source
  URLs — two of them are the spec's own worked examples, and the third
  (Accession's own acquisition, on top of its Risk Strategies DBA) was found
  while researching the first two and kept because it's a genuinely good
  test case.
- `npm run db:seed-firms` loads it. Idempotent (matches by normalized name,
  updates in place) — and re-running it after editing the seed file **fails
  loudly** if two entries would normalize to the same string, rather than
  silently overwriting one with the other. That check exists because it
  caught a real bug during this build: "Marsh McLennan Agency LLC" and
  "Marsh & McLennan Cos. Inc." normalize to the identical string once
  "Agency"/"LLC" are stripped as legal suffixes, which the seed script
  originally would have resolved by quietly renaming the parent's row.
- `test/fixtures/messy-employer-strings.ts` — 70 fixtures (spec asks for
  60+): every seeded firm's canonical name, normalization-equivalent
  variants, the DBA/alias cases, six real fuzzy matches with their actual
  measured trigram scores (0.857–0.941), fourteen deliberately-real near
  misses that fall *just short* of the 0.85 floor, unrelated companies, and
  empty/garbage input. Every expected outcome was checked against real
  `similarity()` scores computed against the actual seeded data in this
  session, not guessed — **100% matched** against a target of 95%.
- `test/firm-resolver.test.ts` runs the fixture set through the actual
  `resolveFirm()` function (not the shadow SQL used to build the fixtures)
  and asserts ≥95%, plus explicit tests for acceptance criteria 9
  ("Woodruff Sawyer" resolves and applies the Gallagher rule), 10
  (the spec's own DBA string resolves through the alias path), and 11
  (a fuzzy match still requires manual confirmation).

### What's still ahead for the firm graph

- No UI hook yet: `/candidates`' firm field is still a manual dropdown
  (Phase 0 MVP). Wiring `resolveFirm()` into candidate creation — showing
  the match and its confidence, routing sub-0.95 matches to a manual-review
  queue — is a natural Phase 3 task, not done here to keep this phase's
  scope to "the resolver actually works," per the spec's own emphasis.
- No `needs_manual_review` queue/table yet — the resolver reports the
  status, but nothing persists or surfaces a review backlog. That's part of
  Phase 2 (migration) and Phase 3 (core records UI) in the spec's build
  order, once there's real messy data to review.
- The abbreviation-expansion list in `normalize.ts` is a small, explicitly
  non-exhaustive set — there's no canonical dictionary to verify it
  against, unlike the legal-suffix list the spec gives verbatim.

## Why hand-written SQL migrations

Migrations live as plain `.sql` files in `src/db/migrations/`, applied by a
small custom runner (`src/db/migrate.ts`) rather than `drizzle-kit`'s
generated migrations. Two reasons:

1. The audit-log lockdown (`REVOKE`, trigger) and role grants are security
   properties, not table shape — they read better as explicit, reviewable
   SQL than as `drizzle-kit` codegen output.
2. This session's sandbox had no npm registry access (see "A note on this
   session's constraints" below), so `drizzle-kit generate` could not be
   run to produce its own migration files. Hand-written SQL sidesteps that
   without weakening the result — Drizzle's schema (`src/db/schema.ts`) and
   the SQL migrations are kept in sync by hand and should match; a future
   session with registry access could switch to `drizzle-kit` generation if
   preferred, or add a CI check that diffs generated SQL against the
   hand-written files.

`drizzle.config.ts` is still present so `drizzle-kit studio` / introspection
tools work against the resulting schema.

## Running locally

```bash
cp .env.example .env      # fill in real values before anything but local dev
npm install
npm run db:migrate        # applies src/db/migrations/*.sql via MIGRATIONS_DATABASE_URL
# set the app role's password once per environment (not in a migration):
psql "$MIGRATIONS_DATABASE_URL" -c "ALTER ROLE palladium_app PASSWORD '...' LOGIN;"
psql "$MIGRATIONS_DATABASE_URL" -c "GRANT CONNECT ON DATABASE ... TO palladium_app;" # done by the migration itself
npm run db:seed           # SEED_ADMIN_EMAIL=you@firm.com, dev only
npm run dev
```

### Running tests locally

The test suite is integration-first on purpose — the guarantees that matter
here (audit-log immutability, a real restore) only mean something against a
real Postgres and real S3-compatible storage, not mocks. You need:

- A local Postgres reachable at `OWNER_DATABASE_URL` (a superuser/owner
  connection) and `APP_DATABASE_URL` (the `palladium_app` role — the test
  suite sets its password).
- An S3-compatible endpoint (MinIO works well locally) for
  `DOCUMENTS_BUCKET` / `BACKUPS_BUCKET`.
- `pg_dump` / `pg_restore` on `PATH` (same major version as the target
  Postgres).

See `.github/workflows/ci.yml` for the exact env vars and a working MinIO +
Postgres service-container setup — copying that locally (e.g. via
`docker compose`) is the fastest way to get `npm test` green.

## A note on this session's constraints

This repo was built in a sandboxed session with **no access to the npm
registry** (or any other package registry) — `npm install` was not runnable
here. Every file was hand-written and, wherever the underlying mechanism did
not require Node dependencies, verified directly against a real local
Postgres 16 instance with `psql`, `pg_dump`, and `pg_restore`:

- The audit-log lockdown was proven against real roles: the app role gets
  `permission denied` on `UPDATE`/`DELETE`, and even a superuser gets
  blocked by the trigger, with the row provably unchanged afterward.
- The migration files were applied end-to-end (including re-applying them
  to confirm idempotency) against a scratch database.
- The backup → restore drill pipeline was proven with real `pg_dump`
  (`--format=custom`) and `pg_restore`, including a live row-count
  comparison and the foreign-key-introspection query the drill uses to
  detect orphaned rows.
- The export command's primary-key detection and row-to-JSON shape were
  checked against `information_schema` and `row_to_json` directly.
- The MVP's one-active-claim guarantee was proven under an actual
  concurrent race (two simultaneous `INSERT`s on the same candidate from
  two parallel `psql` processes — exactly one succeeds, the other fails
  with `23505 duplicate key value`), and the collision-cooldown query and
  the unclaimed-candidate left-join were both run directly against
  Postgres with the exact SQL the Drizzle query builder produces.
- `src/firms/normalize.ts` and `src/firms/seed-data/top100-2026.ts` have
  zero external dependencies, so unlike everything else in this repo they
  were **actually executed** — via the globally-available `ts-node`, no
  `npm install` needed — against all 70 resolver fixtures and the full
  seed data set. That run caught a real bug before it shipped: two seed
  entries ("Marsh McLennan Agency LLC" and "Marsh & McLennan Cos. Inc.")
  normalized to the identical string, which would have made the seed
  script's upsert-by-normalized-name logic silently overwrite one firm's
  name with the other's. The fix (fail loudly on a collision, and remove
  the redundant seed entry) is in `seedFirms.ts` and the seed data file.
- The resolver's three tiers (exact, alias, `pg_trgm` fuzzy) and the
  acquisition-chain walk were each verified end-to-end with real SQL
  against the fully seeded database, including the two spec-quoted
  acceptance-criteria examples (Woodruff Sawyer → Gallagher, Accession →
  Risk Strategies) and the seed script's idempotency (re-running produces
  identical row counts).

What was **not** run in this session: `npm install`, `next build`, `tsc`
against the real dependency graph, or `vitest` itself, since none of those
tools were installable without registry access. The code is written to
compile and pass against the pinned dependency versions in `package.json`,
but that has not been machine-verified end-to-end here. **Before treating
Phase 0 as done, run `npm install && npm run typecheck && npm run lint &&
npm test` in an environment with normal network access (this repo's own CI
will do this automatically on the first push).**

## Open questions (spec section 12)

These are defaults chosen so the build isn't blocked, not decisions the
client has made. Confirm each before relying on it:

1. **Ownership tie-break and window** — `search_assignment` beats
   `first_touch`; 90-day rolling exclusivity; 30-day inactivity release.
   *(Not yet built — Phase 5.)*
2. **Acquired-firm eligibility** — acquired by a Top 100 firm stays
   eligible; acquired by a non-list firm goes `conditional`; eligible
   through `announced_at` + 12 months. *(Implemented in
   `walkAcquisitionChain()`, Phase 1 — but only as a resolver-level hint.
   It isn't wired into an actual eligibility/off-limits gate yet; that's
   Phase 8.)*
3. **Crelate export completeness — BLOCKING for Phase 2.** Not yet
   verified in this repo. Confirm resumes, attachments, and full activity
   history are actually extractable via the Crelate API/CSV export before
   any migration code is written.
4. **Data volume** (candidate count, attachment count, years of history) —
   unknown; determines whether Postgres full-text search needs tuning.
5. **ATS scope** — this build assumes full replacement (searches,
   pipelines, placements included).
6. **Approval routing** — default: peer review, no self-approval.
   *(Not yet built — Phase 10.)*
7. **Mailbox / SSO provider** — both Google Workspace and Microsoft
   Entra/365 are wired in `src/auth/config.ts`, gated on which env vars are
   set. Confirm which one the firm actually uses before Phase 6 (email
   sync) and delete the unused provider's code path rather than leaving a
   dead option live.
8. **LinkedIn posture** — assisted send only. Automation is a documented,
   currently-disabled feature flag requiring a separate legal review, not a
   default. *(Not yet built — Phase 12.)*
9. **Volume** — assumed under 200 candidates/recruiter/week; revisit queue
   architecture above ~2,000 scheduled sends/week.
10. **Top 100 refresh** — annual, manual reseed from a versioned data file.
    Confirm whether candidates at firms falling off the list stay eligible.
11. **Data protection basis** — assumed US-only targets under legitimate
    interest. Any EU/UK/strict-state target goes to legal before Phase 8.
12. **Retention** — default: indefinite with annual review, anonymize on
    request.

## Guardrails this repo already enforces

- `audit_log` is append-only at the database level (`REVOKE UPDATE, DELETE`
  from every role, plus a trigger). No application code path can widen this
  without editing a migration a reviewer would see.
- The app connects to Postgres as `palladium_app`, never as the migrations
  owner/superuser.
- The kill switch is a single boolean read fresh on every check
  (`isOutboundEnabled()`), not cached — required so a halt takes effect
  within one polling interval once the send worker exists.
- `linkedin_automation` ships seeded `false` with the ToS/account-risk
  rationale in the row itself (`feature_flags.description`), matching spec
  3.2: this is a deliberate, logged risk acceptance to flip, not a default.
- No local passwords anywhere in the auth path.

## What's deliberately deferred, not forgotten

- The money-path lint rule (bare `number` banned from `Cents` fields, spec
  3.8) belongs with the financials tables it protects, not Phase 0, since
  there are no money columns yet to protect and a blanket ban on `number`
  would be wrong for the rest of the codebase.
- Bucket versioning/lifecycle rules (35-day backup retention,
  document versioning) are infrastructure provisioning (Terraform/console),
  not application code — `deletePastRetention()` in `src/custody/backup.ts`
  is a redundant application-level enforcement for providers without
  lifecycle support, not the primary mechanism.
