# Import fixtures

`active_engagements.csv` is **fixture data, not a real legacy system export**.
This environment has no access to a real legacy ATS/spreadsheet to pull from
-- per section 0 hard rule 1 ("never mock an integration"), the importer
itself (`src/import/runNarrowImport.ts`, `src/import/types.ts`) is written
against an honestly-documented CSV contract this repo defines, not against
guessed behavior of a real external system. This fixture exists so that
contract is exercisable end to end (`npm run import:narrow`) before real
export files exist.

Before any live work enters the system, `active_engagements.csv` must be
replaced with the firm's actual narrow export (DECISION 4: active
engagements plus 24 months of placements) mapped into this same column
shape, or `src/import/types.ts`'s `NarrowImportRow` adjusted to match
whatever the real export actually looks like. Whichever changes, re-run the
importer against the real file and re-run the merge review queue and data
quality report (`npm run dataquality:report`) before treating the import as
done -- see `/docs/manual-steps.md`.

Includes deliberately: two rows that should resolve to the same person via
the fuzzy-match tier (`P-1004`/`P-1005`, "Katherine Miller"/"Kathy Miller" at
the same brokerage) to exercise the merge review queue, one `do_not_contact`
row, one placement row with legacy spreadsheet-calculated commission data
for the Phase 2 shadow harness to eventually consume, and one row missing
`engagement_owner_email` to exercise the data quality report's "ownerless
engagement" check.
