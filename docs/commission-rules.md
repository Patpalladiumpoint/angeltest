# Commission rules (derived output of Phase 2)

Not started. DECISION 6: "Do not wait for a written statement of commission
rules... The rule set is an *output*, written here, produced by running the
shadow harness against 24 months of historical placements
(`legacy_placement_import.legacy_commission_amount`, staged by Phase 1's
narrow importer) until every delta against the spreadsheet is explained."

This file stays empty until Phase 2 does that work. See
`src/db/schema.ts`'s comment above `legacyPlacementImport` for exactly what
Phase 1 staged for Phase 2 to consume, and DECISION 7 ("replicate current
commission policy exactly, bug for bug") for why this has to be derived
from real historical data rather than written from a policy description.
