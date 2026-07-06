-- ===========================================================================
-- Project documents: optional link to a specific change order
-- ===========================================================================
-- Adds project_documents.change_order_id so a document can be pinned to one
-- change order and appear in that CO's "Files" section. The column is nullable
-- — existing documents and project-level uploads stay unlinked. A voided or
-- deleted CO nulls the link (ON DELETE SET NULL) rather than removing the file.
--
-- Ordering: run THIS migration in Supabase first, THEN deploy the app code.
-- The change-order detail page and the upload action select/write this column,
-- so deploying code first would error on the missing column.
--
-- Plain ADD COLUMN (safe inside a transaction; the Supabase SQL editor is fine).
-- IF NOT EXISTS makes it safe to re-run.

ALTER TABLE project_documents
  ADD COLUMN IF NOT EXISTS change_order_id uuid
  REFERENCES change_orders (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS project_documents_change_order_idx
  ON project_documents (change_order_id);
