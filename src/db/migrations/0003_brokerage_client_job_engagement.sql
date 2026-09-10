-- Brokerage, client, client_contract, job, engagement, placement (spec 3.1).
-- brokerage.rank is operationally load-bearing (the firm only contacts
-- candidates inside the top 100 brokerages); rank_as_of plus the
-- engagement.brokerage_rank_snapshot below keep eligibility auditable when
-- the Top 100 list is refreshed later.

CREATE TABLE IF NOT EXISTS brokerage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  name text NOT NULL,
  normalized_name text NOT NULL,
  rank integer,
  rank_source text,
  rank_as_of timestamptz,
  is_client boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_name)
);

DO $$ BEGIN
  ALTER TABLE person_employment
    ADD CONSTRAINT person_employment_brokerage_fk FOREIGN KEY (brokerage_id) REFERENCES brokerage(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE client_tier AS ENUM ('strategic', 'standard', 'prospect');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE client_status AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS client (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brokerage_id uuid NOT NULL REFERENCES brokerage(id),
  tier client_tier NOT NULL DEFAULT 'standard',
  owner_user_id uuid REFERENCES app_user(id),
  status client_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE fee_model AS ENUM ('contingency', 'retained', 'hourly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE fee_basis AS ENUM ('first_year_cash', 'total_comp', 'flat');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Section 8: recruiters cannot see fee_percent ("Client fee percent: No").
-- Column-level SELECT is revoked from palladium_app in
-- 0007_permissions_and_dnc.sql; reads go through get_client_contract_fee_percent().
CREATE TABLE IF NOT EXISTS client_contract (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES client(id),
  fee_model fee_model NOT NULL DEFAULT 'contingency',
  fee_percent double precision,
  fee_basis fee_basis NOT NULL DEFAULT 'first_year_cash',
  guarantee_days integer NOT NULL DEFAULT 90,
  payment_terms_days integer NOT NULL DEFAULT 30,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('open', 'on_hold', 'filled', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Section 8: job.fee_override carries the same fee-percent-adjacent
-- sensitivity as client_contract.fee_percent (it overrides the contract fee
-- for one job) -- same column-level lockdown applies to it in 0007.
CREATE TABLE IF NOT EXISTS job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES client(id),
  contract_id uuid REFERENCES client_contract(id),
  title text NOT NULL,
  status job_status NOT NULL DEFAULT 'open',
  fee_override double precision,
  target_comp_range_min integer,
  target_comp_range_max integer,
  owner_user_id uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- DECISION 2: nine stages, interview rounds as events inside client_process.
-- The state machine ENGINE (auto-generated tasks, SLA exceptions,
-- transition guards -- spec 5.2/5.3) is Phase 3; this enum exists now so
-- the narrow importer has somewhere to put each imported engagement's
-- current stage.
DO $$ BEGIN
  CREATE TYPE engagement_stage AS ENUM (
    'sourced', 'outreach', 'engaged', 'qualified', 'submitted',
    'client_process', 'offer', 'placed', 'secured',
    'candidate_declined', 'client_rejected', 'withdrawn', 'on_hold', 'fell_off'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE engagement_status AS ENUM ('active', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS engagement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person(id),
  job_id uuid NOT NULL REFERENCES job(id),
  current_stage engagement_stage NOT NULL DEFAULT 'sourced',
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  owner_user_id uuid REFERENCES app_user(id),
  sourcer_user_id uuid REFERENCES app_user(id),
  status engagement_status NOT NULL DEFAULT 'active',
  round_number integer NOT NULL DEFAULT 0,
  rounds_expected integer,
  next_action_due_at timestamptz,
  expected_fee double precision,
  brokerage_rank_snapshot integer,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, job_id)
);

CREATE INDEX IF NOT EXISTS engagement_owner_idx ON engagement (owner_user_id);
CREATE INDEX IF NOT EXISTS engagement_stage_idx ON engagement (current_stage);

DO $$ BEGIN
  CREATE TYPE placement_status AS ENUM ('pending_start', 'started', 'fell_off', 'secured');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- spec 3.1 groups placement with engagement, not the 3.4 money ledger --
-- it's the fact of a placement and its agreed terms. fee.gross_amount
-- (Phase 2) is the recognized ledger entry derived from fee_amount here.
CREATE TABLE IF NOT EXISTS placement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL UNIQUE REFERENCES engagement(id),
  start_date timestamptz,
  guaranteed_through timestamptz,
  accepted_comp jsonb,
  fee_amount double precision,
  fee_calc_snapshot jsonb,
  status placement_status NOT NULL DEFAULT 'pending_start',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON brokerage, client, client_contract, job, engagement, placement TO palladium_app;
