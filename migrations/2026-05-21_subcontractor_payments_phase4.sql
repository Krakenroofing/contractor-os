-- Phase 4 of payroll: subcontractor payment lifecycle.
--
-- Distinct from job_costs.subcontractor entries (which record cost
-- incurred). This table tracks the payment lifecycle: draft → approved
-- → paid (with retainage potentially still held). When retainage is
-- released later, edit the row: drop retainage_held to 0, bump net_paid
-- toward gross. A proper release-event log is Phase 5 polish.

CREATE TABLE IF NOT EXISTS subcontractor_payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vendor_id          uuid NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  -- Project is optional — general subcontractor work that isn't tied to
  -- a specific job (warehouse, equipment maintenance, etc.).
  project_id         uuid REFERENCES projects(id) ON DELETE SET NULL,
  work_period_start  date NOT NULL,
  work_period_end    date NOT NULL,
  -- Free-text description of what was done — the "scope area completed"
  -- that justifies the payment.
  scope_description  text NOT NULL,
  gross_amount       numeric(12, 2) NOT NULL DEFAULT 0,
  -- Percentage withheld per the contract (e.g. 10.000 for 10%).
  retainage_percent  numeric(6, 3)  NOT NULL DEFAULT 0,
  -- Dollars currently held back. Starts at gross × retainage% on create,
  -- edited downward when retainage is released.
  retainage_held     numeric(12, 2) NOT NULL DEFAULT 0,
  -- Dollars actually paid out so far. gross - retainage_held; stored so
  -- it doesn't drift from the source.
  net_paid           numeric(12, 2) NOT NULL DEFAULT 0,
  paid_date          date,
  -- 'draft' | 'approved' | 'paid' | 'void'. paid means net_paid has hit
  -- the bank; retainage_held may still be > 0 (held for warranty/final).
  status             text NOT NULL DEFAULT 'draft',
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subcontractor_payments_company_idx
  ON subcontractor_payments (company_id);

CREATE INDEX IF NOT EXISTS subcontractor_payments_vendor_idx
  ON subcontractor_payments (vendor_id);

CREATE INDEX IF NOT EXISTS subcontractor_payments_project_idx
  ON subcontractor_payments (project_id);

CREATE INDEX IF NOT EXISTS subcontractor_payments_period_idx
  ON subcontractor_payments (company_id, work_period_start);
