-- Interviews as a first-class entity (section 9), not folded into
-- engagement.round_number the way DECISION 2 originally treated rounds.
-- Round-as-event still holds at the *stage* level (client_process doesn't
-- become five stages) -- this table is what actually tracks each round's
-- scheduling, feedback, and status, which round_number alone can't.

DO $$ BEGIN
  CREATE TYPE interview_type AS ENUM ('sendout', 'follow_up', 'final', 'debrief', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE interview_status AS ENUM ('scheduled', 'completed', 'canceled', 'rescheduled', 'no_show');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE meeting_type AS ENUM ('phone', 'video', 'in_person');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS interview (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES engagement(id),
  round_number integer NOT NULL DEFAULT 1,
  interview_type interview_type NOT NULL DEFAULT 'sendout',
  scheduled_at timestamptz,
  timezone text NOT NULL DEFAULT 'America/New_York',
  meeting_type meeting_type NOT NULL DEFAULT 'video',
  meeting_url text,
  status interview_status NOT NULL DEFAULT 'scheduled',
  candidate_feedback text,
  candidate_feedback_received_at timestamptz,
  client_feedback text,
  client_feedback_received_at timestamptz,
  owner_user_id uuid REFERENCES app_user(id),
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interview_engagement_idx ON interview (engagement_id);
CREATE INDEX IF NOT EXISTS interview_scheduled_at_idx ON interview (scheduled_at);
CREATE INDEX IF NOT EXISTS interview_status_idx ON interview (status);

-- Participants: internal interviewers are app_users; a candidate is
-- implied by the parent engagement (not duplicated here); client-side
-- interviewers usually aren't in our system at all, so they're captured
-- as plain name/email rather than forcing a client_contact row to exist
-- for someone who may never touch the portal.
CREATE TABLE IF NOT EXISTS interview_participant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL REFERENCES interview(id),
  app_user_id uuid REFERENCES app_user(id),
  external_name text,
  external_email text,
  role text NOT NULL DEFAULT 'interviewer',
  CONSTRAINT interview_participant_identity CHECK (
    (app_user_id IS NOT NULL) OR (external_name IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS interview_participant_interview_idx ON interview_participant (interview_id);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interview_set_updated_at ON interview;
CREATE TRIGGER interview_set_updated_at BEFORE UPDATE ON interview FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON interview, interview_participant TO palladium_app;
