# Runbook

Section 11: "part of the definition of done for every phase." This covers
Phase 1 (foundation and narrow import). Later phases add their own
sections here rather than starting a new document.

## Restoring from backup

1. Find the latest backup: list `s3://$BACKUPS_BUCKET/postgres/` (or run
   `npm run backup:restore-drill`, which does this automatically against
   `RESTORE_DRILL_DATABASE_URL` and prints the row-count/orphan-FK report).
2. For a real restore (not a drill), download the `.dump` object and run
   `pg_restore --no-owner --dbname <target> <file>` against a fresh,
   empty database -- never `--clean` against a live one without a second
   confirmation, since `pg_restore` does not ask twice.
3. After restoring, immediately re-run the row-count/orphan-FK checks
   `src/custody/restoreDrill.ts` runs (or just invoke
   `runRestoreDrill()` against the restored DB as source) before treating
   the restore as trustworthy.
4. `last successful restore drill` is recorded as an `event`
   (`type = 'restore_drill.completed'`) -- query
   `SELECT * FROM event WHERE type IN ('backup.completed','restore_drill.completed') ORDER BY occurred_at DESC LIMIT 5;`
   to see recent custody operations.

## Reversing a bad person merge

1. Find the `person_merge` row: `SELECT * FROM person_merge WHERE surviving_person_id = '<id>' AND reversed_at IS NULL ORDER BY merged_at DESC;`
2. Call `reversePersonMerge(personMergeId, actor)` (`src/identity/merge.ts`)
   -- do not hand-edit `person_identifier`/`person_employment`/`engagement`
   rows directly; the function moves back exactly what the merge moved,
   recorded in `person_merge.absorbed_snapshot.moves`.
3. Confirm: the absorbed person's row was never deleted (`SELECT * FROM person WHERE id = '<absorbed_id>'` still returns it), and the moved
   rows are back on it.

## Correcting a bad audit_log or event row

You can't -- both are append-only at the database level (`REVOKE
UPDATE, DELETE` plus a trigger, `migrations/0004_process_tables.sql`). If a
row was written with wrong data, write a new row correcting the record
(e.g. a new `audit_log` entry with `action = 'correction'` referencing the
bad row's id in `before`/`after`), never attempt to edit history.

## Working the merge review queue

`/merge-queue` lists every `person_merge_candidate` with `status = 'pending'`
(spec 3.2 step 2: strong pg_trgm name match + matching current employer,
threshold documented in `src/identity/resolver.ts`). For each:

- **Same person** -> click "Keep X, merge the other in." This runs
  `mergePerson()`: moves identifiers/employment/engagements that don't
  conflict with the survivor's own, records what moved, marks the
  candidate `merged`.
- **Not a duplicate** -> click "Not a duplicate." Marks the candidate
  `rejected`; it will not resurface (the ordered-pair unique constraint
  covers re-imports of the same pair, but a genuinely new similarity
  signal on a later re-run can still enqueue a fresh row -- that's
  intentional, not a bug).

Phase 1 exit condition: this queue at zero pending rows before treating the
narrow import as done.

## Running the narrow importer

```bash
npm run import:narrow -- /path/to/export.csv [organization_id]
```

Omitting the file uses `src/import/fixtures/active_engagements.csv` (see
`docs/manual-steps.md` #1 -- replace with a real export before live use).
Idempotent: re-running against the same file updates existing
engagements/placements rather than duplicating them (matched on each row's
`external_id`).

## Running the data quality report

```bash
npm run dataquality:report
```

Or view it at `/dashboard`. See `src/dataquality/report.ts` for what each
section means. Work every non-empty section to zero before Phase 1 is done
(section 0 rule 9: never call a phase done on passing tests alone -- this
report, worked to zero, is the human-verified part of "done" for Phase 1).

## Adding a new app_user

```sql
INSERT INTO app_user (organization_id, email, name, role)
VALUES ('<org id>', 'person@palladiumpoint.com', 'Person Name', 'recruiter'); -- or 'ops' / 'exec'
```

Or extend `src/db/seed.ts`'s env vars (`SEED_RECRUITER_EMAILS`,
`SEED_OPS_EMAILS`, `SEED_EXEC_EMAIL`) and re-run `npm run db:seed`
(idempotent).

## What every Phase 1 exception rule means

None yet -- the `exception`/rule_id engine is Phase 3 (spec 5.4's nightly
consistency job). Phase 1's equivalent is the plain data quality report
above, which has no `rule_id`s to document.
