-- Phase 1 import staging, additive and not part of spec section 3 (see the
-- long comment above legacyPlacementImport in src/db/schema.ts for why).
-- DECISION 4 requires importing 24 months of placements with their fees,
-- invoices, payments, and spreadsheet-calculated commissions; the real
-- fee/invoice/payment/commission_entry ledger doesn't exist until Phase 2
-- builds the commission engine (DECISION 6), so Phase 1 stages the raw
-- historical facts here instead.

CREATE TABLE IF NOT EXISTS legacy_placement_import (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  engagement_id uuid REFERENCES engagement(id),
  placement_id uuid REFERENCES placement(id),
  recruiter_email text,
  start_date timestamptz,
  accepted_comp jsonb,
  fee_amount double precision,
  invoice_amount double precision,
  invoice_issued_at timestamptz,
  payment_amount double precision,
  payment_received_at timestamptz,
  legacy_commission_amount double precision,
  raw_row jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legacy_placement_import_engagement_idx ON legacy_placement_import (engagement_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON legacy_placement_import TO palladium_app;
