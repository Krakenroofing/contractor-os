-- Phase 4.9: frozen paystubs for locked periods.
--
-- When you click "Lock & post period" on /payroll, the action computes
-- paystubs live one last time and writes them here. Subsequent reads
-- of a locked period reconstruct paystubs from these rows instead of
-- recomputing — so editing an employee's pay rate AFTER posting no
-- longer rewrites historical paystubs.
--
-- Unlocking a period clears these rows; future computes go live again.

CREATE TABLE IF NOT EXISTS period_paystub_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  pay_period_id     uuid NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  -- Snapshot of identifying details so deleted employees still render
  -- sensibly on a locked paystub.
  employee_name     text NOT NULL,
  employment_type   text NOT NULL,
  -- Frozen computed fields. Source of truth for the paystub after lock.
  pay_rate          numeric(12, 4) NOT NULL,
  hours_worked      numeric(7, 2)  NOT NULL DEFAULT 0,
  gross             numeric(12, 2) NOT NULL DEFAULT 0,
  insurable_wage    numeric(12, 2) NOT NULL DEFAULT 0,
  employee_nib      numeric(12, 2) NOT NULL DEFAULT 0,
  employer_nib      numeric(12, 2) NOT NULL DEFAULT 0,
  net               numeric(12, 2) NOT NULL DEFAULT 0,
  nib_exempt        boolean        NOT NULL DEFAULT false,
  -- 'override' | 'rate' | 'none' — where the gross came from at lock.
  gross_source      text NOT NULL DEFAULT 'none',
  snapshotted_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS period_paystub_snapshots_company_idx
  ON period_paystub_snapshots (company_id);

CREATE INDEX IF NOT EXISTS period_paystub_snapshots_period_idx
  ON period_paystub_snapshots (pay_period_id);

CREATE UNIQUE INDEX IF NOT EXISTS period_paystub_snapshots_emp_period_uq
  ON period_paystub_snapshots (pay_period_id, employee_id);
