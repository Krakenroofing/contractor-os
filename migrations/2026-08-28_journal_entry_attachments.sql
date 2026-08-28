-- Journal entry attachments: supporting documents on MANUAL journal entries
-- (the working paper behind an adjustment). Run in the Supabase SQL editor
-- BEFORE deploying the application code.
--
-- Only manual entries carry attachments — system-posted entries are deleted
-- and re-created by GL rebuilds (new ids), which would cascade-orphan any
-- attachment. The server action enforces source_type = 'manual'.
--
-- The `journal-entry-attachments` Storage bucket is created here (private),
-- same pattern as team-task-attachments.

CREATE TABLE IF NOT EXISTS journal_entry_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  uploaded_by uuid,
  original_file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journal_entry_attachments_entry_idx
  ON journal_entry_attachments (journal_entry_id);
CREATE INDEX IF NOT EXISTS journal_entry_attachments_company_idx
  ON journal_entry_attachments (company_id);

-- Storage bucket (private). Idempotent.
INSERT INTO storage.buckets (id, name, public)
VALUES ('journal-entry-attachments', 'journal-entry-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Verification
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'journal_entry_attachments';
SELECT id FROM storage.buckets WHERE id = 'journal-entry-attachments';
