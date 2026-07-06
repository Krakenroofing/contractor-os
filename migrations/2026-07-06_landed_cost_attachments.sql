-- ===========================================================================
-- Landed cost: shipping-document attachments
-- ===========================================================================
-- Lets a landed-cost entry hold its shipping documents (broker/Tropical
-- invoice, SAD, bill of lading, packing list). Blobs reuse the existing
-- `project-documents` Supabase Storage bucket under
-- `{companyId}/landed-cost/{landedCostId}/...` — NO new bucket to create.
--
-- Ordering: run THIS migration in Supabase first, THEN deploy the app code
-- (the detail page lists these attachments).
--
-- Plain CREATE TABLE (safe in a transaction). IF NOT EXISTS = re-runnable.

CREATE TABLE IF NOT EXISTS landed_cost_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  landed_cost_id uuid NOT NULL REFERENCES landed_costs (id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL DEFAULT 0,
  original_file_name text NOT NULL,
  uploaded_by uuid REFERENCES users (id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS landed_cost_attachments_lc_idx
  ON landed_cost_attachments (landed_cost_id);
CREATE INDEX IF NOT EXISTS landed_cost_attachments_company_idx
  ON landed_cost_attachments (company_id);
