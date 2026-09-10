-- Phase 0 ("Mirror and prove", spec section 7): read-only mirror tables plus
-- the two spines everything else in the build hangs off of --
-- event (spec 3.2, "every inbound signal becomes an event row first") and
-- sync_record (spec 5, provenance + idempotency for every external pull).
--
-- Deliberately minimal per entity. Only the columns Phase 0's own checklist
-- needs are here ("engagements with no owner, placements with no invoice,
-- invoices with no placement, stage values that do not map, duplicate
-- candidates"). Fee/commission columns (client_contract, fee, commission_*)
-- are Phase 1 and are not created here -- an unconstrained placeholder
-- column today would just be a guess about Phase 1's shape.

DO $$ BEGIN
  CREATE TYPE engagement_status AS ENUM ('active', 'on_hold', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE engagement_health AS ENUM ('on_track', 'at_risk', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- spec 3.1: "client (brokerage; tier, contract terms, owner_user_id)".
-- contract terms live in client_contract (Phase 1) -- not created here.
CREATE TABLE IF NOT EXISTS client (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tier text,
  owner_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- spec 3.1: "job (search assignment; client_id, fee override, status,
-- target_comp_range, exclusivity)". fee_override is Phase 1 money-spine
-- shaped and not created here -- see migration header.
CREATE TABLE IF NOT EXISTS job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES client(id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  target_comp_range jsonb,
  exclusivity boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_client_idx ON job (client_id);

-- spec 3.1: "candidate (mirror of Crelate; crelate_id UNIQUE, name,
-- current_employer, current_title, comp_data, source, do_not_contact)".
CREATE TABLE IF NOT EXISTS candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crelate_id text NOT NULL UNIQUE,
  name text NOT NULL,
  current_employer text,
  current_title text,
  comp_data jsonb,
  source text,
  do_not_contact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- spec 3.1: "engagement (THE central object: candidate_id + job_id, unique
-- together. current_stage, stage_entered_at, owner_user_id,
-- sourcer_user_id, status, next_action_due_at, health)". current_stage is
-- free text here on purpose -- the declarative stage config (spec 4.1) that
-- would validate it against a real enum is Phase 2. Phase 0's own
-- reconciliation checklist item "stage values that do not map" is exactly
-- the check that catches a stage value with no config to validate against,
-- once that config exists; until then the check reports "not yet
-- applicable" rather than a fabricated stage list (see
-- src/db/reconciliation.ts).
CREATE TABLE IF NOT EXISTS engagement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidate(id),
  job_id uuid NOT NULL REFERENCES job(id),
  current_stage text,
  stage_entered_at timestamptz,
  owner_user_id uuid REFERENCES users(id),
  sourcer_user_id uuid REFERENCES users(id),
  status engagement_status NOT NULL DEFAULT 'active',
  next_action_due_at timestamptz,
  health engagement_health NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, job_id)
);

CREATE INDEX IF NOT EXISTS engagement_job_idx ON engagement (job_id);
CREATE INDEX IF NOT EXISTS engagement_owner_idx ON engagement (owner_user_id);

-- spec 3.1: "placement (engagement_id, start_date, guaranteed_through,
-- accepted_comp, fee_amount, fee_calc_snapshot jsonb, status)". fee_amount
-- is nullable on purpose: "placements with no invoice" and "placement with
-- no fee" (spec 7, Phase 0 checklist) are data-quality findings this phase
-- exists to surface, not resolve -- the actual deterministic fee
-- calculation is Phase 1 (spec 6, "Money math is deterministic code, never
-- a model").
CREATE TABLE IF NOT EXISTS placement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL UNIQUE REFERENCES engagement(id),
  start_date date,
  guaranteed_through date,
  accepted_comp jsonb,
  fee_amount numeric(12, 2),
  fee_calc_snapshot jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- spec 3.3: invoice.fee_id normally points at fee(id), which is Phase 1.
-- placement_id here is Phase 0's own best-effort link (nullable, and never
-- populated by this phase's pull -- there is no matching logic yet). Left
-- null, it is exactly the "invoice with no placement" finding the
-- reconciliation dashboard is supposed to report; Phase 1's fee entity
-- replaces this column, it does not extend it.
CREATE TABLE IF NOT EXISTS invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quickbooks_id text NOT NULL UNIQUE,
  placement_id uuid REFERENCES placement(id),
  issued_at timestamptz,
  due_at timestamptz,
  amount numeric(12, 2) NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_placement_idx ON invoice (placement_id);

CREATE TABLE IF NOT EXISTS payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quickbooks_id text NOT NULL UNIQUE,
  invoice_id uuid REFERENCES invoice(id),
  received_at timestamptz NOT NULL,
  amount numeric(12, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_invoice_idx ON payment (invoice_id);

-- spec 3.2: "event (immutable append only log)". This is the spine: every
-- inbound signal becomes a row here first, and state is derived from it.
-- external_id is the idempotency key (spec 5: "every inbound signal
-- carries an external_id. Duplicate ingestion must be a no op").
CREATE TABLE IF NOT EXISTS event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  source text NOT NULL,
  entity_type text,
  entity_id text,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  external_id text UNIQUE
);

CREATE INDEX IF NOT EXISTS event_entity_idx ON event (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS event_source_idx ON event (source, type);

-- event is append-only for the same reason audit_log is (spec 3.2: "events
-- are immutable"). Same two-layer enforcement as 0002_audit_log_lockdown.sql.
REVOKE UPDATE, DELETE ON event FROM palladium_app;
REVOKE UPDATE, DELETE ON event FROM PUBLIC;

CREATE OR REPLACE FUNCTION event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'event is append-only: % is not permitted (row id %)',
    TG_OP,
    COALESCE(OLD.id::text, 'unknown');
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_no_update ON event;
CREATE TRIGGER event_no_update
  BEFORE UPDATE ON event
  FOR EACH ROW EXECUTE FUNCTION event_immutable();

DROP TRIGGER IF EXISTS event_no_delete ON event;
CREATE TRIGGER event_no_delete
  BEFORE DELETE ON event
  FOR EACH ROW EXECUTE FUNCTION event_immutable();

-- spec 3.2: "sync_record (system, external_id, internal_entity, internal_id,
-- last_pulled_at, last_pushed_at, last_hash, drift_detected_at)". This is
-- the generic provenance/idempotency table -- individual entity tables do
-- NOT get their own ad hoc external-id columns beyond the one the spec
-- names explicitly (candidate.crelate_id), so provenance for client/job/
-- invoice/payment lives here instead of being scattered per table.
CREATE TABLE IF NOT EXISTS sync_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system text NOT NULL,
  external_id text NOT NULL,
  internal_entity text NOT NULL,
  internal_id text NOT NULL,
  last_pulled_at timestamptz,
  last_pushed_at timestamptz,
  last_hash text,
  drift_detected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (system, external_id, internal_entity)
);

CREATE INDEX IF NOT EXISTS sync_record_internal_idx ON sync_record (internal_entity, internal_id);

GRANT SELECT, INSERT, UPDATE ON
  client, job, candidate, engagement, placement, invoice, payment, sync_record
  TO palladium_app;
GRANT SELECT, INSERT ON event TO palladium_app;
