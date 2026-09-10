-- Financial operating system (section 11): invoice, payment, commission.
-- Internal only, enforced at the database level the same way comp/
-- fee_percent already are (migrations/0007) -- table-level SELECT is
-- revoked from palladium_app entirely (not just one column this time,
-- the whole table), and reads go exclusively through SECURITY DEFINER
-- functions that return nothing for any actor role that isn't explicitly
-- recognized. That's a default-deny allowlist, not a denylist: a client
-- portal request (which never calls withActor(), so app.actor_role is
-- unset for that connection) gets zero rows back from the functions AND
-- permission denied on any direct table query, the same double layer
-- proven against Postgres for fee_percent in an earlier session.
--
-- This is a direct percentage-based commission model (fee x percent =
-- amount), not the original spec's versioned-plan/shadow-harness ledger
-- (spec 3.4/DECISION 6) -- that design requires real historical placement
-- data to calibrate against and reconcile to zero delta, which doesn't
-- exist in this environment. Documented explicitly in docs/security.md
-- and docs/mvp-status.md: this is real, functional, DB-verified
-- commission tracking, not a placeholder -- but it has not been
-- reconciled against actual historical payroll and must not run real
-- payroll before that reconciliation happens.

DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'void');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE commission_eligibility AS ENUM ('pending', 'eligible', 'ineligible');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE commission_payment_status AS ENUM ('unpaid', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id uuid NOT NULL REFERENCES placement(id),
  client_id uuid NOT NULL REFERENCES client(id),
  invoice_number text NOT NULL UNIQUE,
  amount double precision NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  status invoice_status NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_placement_idx ON invoice (placement_id);
CREATE INDEX IF NOT EXISTS invoice_client_idx ON invoice (client_id);
CREATE INDEX IF NOT EXISTS invoice_status_idx ON invoice (status);
CREATE INDEX IF NOT EXISTS invoice_due_at_idx ON invoice (due_at) WHERE status NOT IN ('paid', 'void');

CREATE TABLE IF NOT EXISTS payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoice(id),
  amount double precision NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  entered_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_invoice_idx ON payment (invoice_id);

CREATE TABLE IF NOT EXISTS commission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id uuid NOT NULL REFERENCES placement(id),
  recruiter_user_id uuid NOT NULL REFERENCES app_user(id),
  placement_fee double precision NOT NULL,
  commission_percent double precision NOT NULL,
  commission_amount double precision NOT NULL,
  eligibility_status commission_eligibility NOT NULL DEFAULT 'pending',
  payment_status commission_payment_status NOT NULL DEFAULT 'unpaid',
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commission_placement_idx ON commission (placement_id);
CREATE INDEX IF NOT EXISTS commission_recruiter_idx ON commission (recruiter_user_id);

-- Writes stay table-level granted (server actions gate who may call them,
-- same pattern the rest of the app uses -- see docs/security.md's "write
-- authorization" section for why this boundary is DB-enforced on the read
-- side and server-action-enforced on the write side). Reads are revoked
-- entirely and re-opened only through the functions below.
GRANT SELECT, INSERT, UPDATE ON invoice, payment, commission TO palladium_app;
REVOKE SELECT ON invoice, payment, commission FROM palladium_app;

CREATE OR REPLACE FUNCTION invoices_for_actor() RETURNS SETOF invoice AS $$
DECLARE v_role text := current_actor_role();
BEGIN
  IF v_role IN ('ops', 'exec', 'admin') THEN
    RETURN QUERY SELECT * FROM invoice;
  ELSIF v_role = 'recruiter' THEN
    RETURN QUERY
      SELECT i.* FROM invoice i
      JOIN placement p ON p.id = i.placement_id
      JOIN engagement e ON e.id = p.engagement_id
      WHERE e.owner_user_id = current_actor_user_id();
  END IF;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION payments_for_actor() RETURNS SETOF payment AS $$
DECLARE v_role text := current_actor_role();
BEGIN
  IF v_role IN ('ops', 'exec', 'admin') THEN
    RETURN QUERY SELECT * FROM payment;
  ELSIF v_role = 'recruiter' THEN
    RETURN QUERY
      SELECT pay.* FROM payment pay
      JOIN invoice i ON i.id = pay.invoice_id
      JOIN placement p ON p.id = i.placement_id
      JOIN engagement e ON e.id = p.engagement_id
      WHERE e.owner_user_id = current_actor_user_id();
  END IF;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION commissions_for_actor() RETURNS SETOF commission AS $$
DECLARE v_role text := current_actor_role();
BEGIN
  IF v_role IN ('ops', 'exec', 'admin') THEN
    RETURN QUERY SELECT * FROM commission;
  ELSIF v_role = 'recruiter' THEN
    RETURN QUERY SELECT * FROM commission WHERE recruiter_user_id = current_actor_user_id();
  END IF;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION invoices_for_actor() TO palladium_app;
GRANT EXECUTE ON FUNCTION payments_for_actor() TO palladium_app;
GRANT EXECUTE ON FUNCTION commissions_for_actor() TO palladium_app;
