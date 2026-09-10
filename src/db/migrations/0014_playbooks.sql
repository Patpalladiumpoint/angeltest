-- Knowledge / Operating System layer (section 18). Simple structured
-- records, not a Notion rebuild -- title/category/body/owner/status plus
-- optional links to a client or a named workflow, searchable.

DO $$ BEGIN
  CREATE TYPE playbook_category AS ENUM ('sop', 'process', 'template', 'client_preference', 'internal_reference');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE playbook_status AS ENUM ('draft', 'active', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS playbook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category playbook_category NOT NULL DEFAULT 'internal_reference',
  body text NOT NULL DEFAULT '',
  owner_user_id uuid REFERENCES app_user(id),
  status playbook_status NOT NULL DEFAULT 'draft',
  linked_client_id uuid REFERENCES client(id),
  linked_workflow text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS playbook_category_idx ON playbook (category);
CREATE INDEX IF NOT EXISTS playbook_status_idx ON playbook (status);
CREATE INDEX IF NOT EXISTS playbook_title_trgm_idx ON playbook USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS playbook_body_trgm_idx ON playbook USING gin (body gin_trgm_ops);

DROP TRIGGER IF EXISTS playbook_set_updated_at ON playbook;
CREATE TRIGGER playbook_set_updated_at BEFORE UPDATE ON playbook FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON playbook TO palladium_app;
