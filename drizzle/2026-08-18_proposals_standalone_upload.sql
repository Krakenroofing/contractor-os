-- Standalone (uploaded) proposals: a proposal created from an uploaded PDF
-- has no in-app estimate behind it. Also link the archived source PDF.
ALTER TABLE proposals ALTER COLUMN estimate_id DROP NOT NULL;
ALTER TABLE proposals
  ADD COLUMN source_document_id uuid REFERENCES project_documents(id) ON DELETE SET NULL;
