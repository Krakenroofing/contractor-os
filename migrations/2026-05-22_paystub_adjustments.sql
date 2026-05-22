-- Phase 4.10: per-employee, per-period paystub adjustments.
--
-- Line-item adjustments that sit alongside the gross-pay computation:
--   • deduction      → subtracted from gross BEFORE NIB (i.e., pre-NIB,
--                      reduces insurable wages on the C-10).
--   • reimbursement  → added to net, NIB-exempt.
--   • per_diem       → added to net, NIB-exempt.
--   • expense        → added to net, NIB-exempt.
--
-- Multiple rows per (employee, period, type) are allowed so each line
-- item carries its own description that prints on the paystub — e.g.
-- two distinct per-diem trips with their own descriptions.
--
-- Period-lock semantics: mutations are blocked when the parent
-- pay_period is locked. Locked-period reads still walk this table, so
-- the line items remain visible after lock without needing a snapshot.

CREATE TABLE IF NOT EXISTS paystub_adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  pay_period_id   uuid NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('deduction', 'reimbursement', 'per_diem', 'expense')),
  amount          numeric(12, 2) NOT NULL DEFAULT 0,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paystub_adjustments_company_idx
  ON paystub_adjustments (company_id);

CREATE INDEX IF NOT EXISTS paystub_adjustments_period_idx
  ON paystub_adjustments (pay_period_id);

CREATE INDEX IF NOT EXISTS paystub_adjustments_emp_period_idx
  ON paystub_adjustments (employee_id, pay_period_id);

-- Paystub override notes — surfaced on the paystub card as the "Pay
-- description" / slip line for the employee (especially relevant for
-- contract / piecework employees whose pay-stub needs to describe what
-- they were paid for).
--
-- The notes column already exists on period_pay_overrides; this is a
-- no-op for migration repeatability — included here so the phase 4.10
-- migration is self-describing.

-- Snapshot extension: locked periods need to preserve the adjusted-gross
-- math alongside the raw gross. raw_gross is what gross used to mean
-- pre-Phase 4.10. Adding the new columns with defaults keeps existing
-- snapshots forward-compatible (deductions_total = 0 means the row was
-- snapshotted before adjustments existed).

ALTER TABLE period_paystub_snapshots
  ADD COLUMN IF NOT EXISTS adjusted_gross numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deductions_total numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additions_total numeric(12, 2) NOT NULL DEFAULT 0;

-- For any pre-existing snapshots, adjusted_gross should equal the raw
-- gross (no deductions = no adjustment). Idempotent — re-running just
-- overwrites identical values.
UPDATE period_paystub_snapshots
   SET adjusted_gross = gross
 WHERE adjusted_gross = 0
   AND gross <> 0;
