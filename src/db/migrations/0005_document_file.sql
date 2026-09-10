-- document_file (spec 3.1, section 4.2 "Resume handling"). Supabase Storage,
-- signed URLs only (section 2, section 6): storage_path is the object key
-- inside a private bucket -- the app never serves a public URL. See
-- src/storage/documents.ts.

DO $$ BEGIN
  CREATE TYPE document_kind AS ENUM ('resume', 'contract', 'submittal', 'transcript', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE document_parse_status AS ENUM ('pending', 'parsed', 'failed', 'not_applicable');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS document_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  storage_path text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  kind document_kind NOT NULL,
  parsed_profile jsonb,
  parse_status document_parse_status NOT NULL DEFAULT 'pending',
  checksum_sha256 text NOT NULL,
  uploaded_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_file_entity_idx ON document_file (entity_type, entity_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON document_file TO palladium_app;
