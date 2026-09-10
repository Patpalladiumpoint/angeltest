# Manual steps (Phase 1)

Section 0 hard rule 2: "Manual workarounds are a valid MVP answer. Prefer a
documented manual step over a fragile automation." Every manual step this
build relies on, and which deferred item (spec section 10) eliminates it.

## 1. Real legacy export, not fixture data

`src/import/fixtures/active_engagements.csv` is fixture data, not a real
export -- this environment has no access to the firm's actual legacy
system/spreadsheet. **Before any live work enters the system**, a human
must:

1. Produce a real narrow export (DECISION 4: active engagements, 24 months
   of placements) in the CSV shape `src/import/types.ts`'s `NarrowImportRow`
   defines, or update that type to match whatever the real export's actual
   columns are.
2. Run `npm run import:narrow -- /path/to/real-export.csv`.
3. Work the merge review queue (`/merge-queue`) down to zero pending
   candidates.
4. Review `npm run dataquality:report` output and resolve what it surfaces.

Eliminated by: nothing eliminates this step -- it only needs to happen
once, correctly, with real data. Re-running the importer against updated
exports stays available indefinitely (it's idempotent).

## 2. Resume files

`document_file` rows are only created when someone uploads a resume through
the app; the narrow importer does not fetch resume files itself (DECISION 4
scope is "resumes for imported persons only," but no resume file source
exists in this environment to pull from automatically). Each imported
person's resume must be uploaded manually via the person record once that
UI exists (Phase 3).

Eliminated by: nothing in this MVP -- resume ingestion is always either a
manual upload or (post-MVP) an integration with wherever resumes actually
live today.

## 3. Supabase project provisioning

No live Supabase project exists in this environment (no network access to
provision one). Before deploying:

1. Create a Supabase project; enable `pg_trgm` (already default-available)
   and, if Phase 7+ needs it, `pgvector`.
2. Configure Google as an OAuth provider in Supabase Auth, and set
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY`.
3. Create the `documents` storage bucket, private (no public access).
4. Run `npm run db:migrate` against the project's Postgres connection
   string, then set the `palladium_app` role's password
   (`ALTER ROLE palladium_app PASSWORD '...' LOGIN;`) out of band.
5. Seed at least one exec user: `SEED_EXEC_EMAIL=you@palladiumpoint.com npm run db:seed`.

Eliminated by: nothing -- this is one-time infrastructure setup, not an
ongoing manual workaround.

## 4. Backups bucket must be a separate account/region

Section 6 requires backups not to live alongside the primary DB/documents.
`BACKUPS_S3_*` env vars point at a second S3-compatible endpoint (a second
Supabase project's storage, or any other S3-compatible provider) -- there is
no automated check enforcing this is actually a different account; a human
must set it up that way and periodically confirm it hasn't drifted.

Eliminated by: nothing in-app can verify "this is actually a separate
account" -- it's an infrastructure/ops discipline, not a code guarantee.

## 5. Client portal: email delivery has no real provider configured

**Update:** the release blocker this section used to describe (plain-email
sign-in, no verification step at all) is fixed. `src/portal/auth.ts` now
implements real passwordless magic-link auth: a random 32-byte token,
only its SHA-256 hash ever stored (`portal_magic_link`/`portal_session`,
migration 0015), single-use and 15-minute-expiring links, revocable
7-day sessions. Every guarantee (unused-and-unexpired lookup succeeds,
second redemption of the same token fails, an expired link is rejected,
a revoked session stops authenticating) was verified directly against
Postgres, simulating the app role's exact queries, in the session that
built it.

**What's still manual:** there is no real email provider configured in
this environment (no SMTP/API credentials available to wire one). Today,
`src/portal/emailSender.ts`'s `ConsoleEmailSender` only logs the magic
link server-side, and outside production the sign-in page also renders
the link directly in the response (clearly marked "DEV ONLY") so the flow
is clickable without a mail server. Before any real client is given a
portal URL:

1. Pick a transactional email provider (Resend is the most direct fit for
   a Next.js/Vercel stack -- see `src/portal/emailSender.ts`'s header
   comment for the exact steps).
2. Set its API key in the environment.
3. Replace `ConsoleEmailSender` with a real implementation of the
   `EmailSender` interface -- everything that calls it is already
   provider-agnostic.
4. Remove the dev-link rendering in `src/app/portal/sign-in/page.tsx` and
   `actions.ts` (both are clearly commented for exactly this).
5. Send and click one real magic-link email end to end before calling
   this production-ready -- it is not, until that happens at least once
   against a live provider.

Eliminated by: step 3 above -- the token/session lifecycle underneath it
needs no further changes.

## 6. `app_user` provisioning is manual, not self-serve

Signing in with Google (once Supabase Auth is live) only succeeds for an
email that already has an `app_user` row -- section 8's three roles are
assigned by an admin inserting/seeding that row, never by the act of
signing in. Provisioning a new hire is: insert an `app_user` row with the
right role (via `db:seed`-style script or direct SQL), then they sign in.

Eliminated by: nothing in this MVP -- a self-serve invite flow is out of
scope (section 1's "NOT in the MVP" list implicitly covers this: no admin
UI for anything beyond data).
