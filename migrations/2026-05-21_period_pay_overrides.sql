-- Phase 4.6: per-employee, per-period gross pay overrides.
--
-- When present for a given (employee, pay_period), this row's gross
-- amount becomes the paystub gross — replacing whatever would have been
-- computed from time entries × pay rate. Lets payroll handle employees
-- whose pay varies week-to-week (piecework, commission, contract,
-- lump-sum) and also handles one-off bonuses or adjustments for hourly /
-- salaried employees.
--
-- Unique on (employee_id, pay_period_id) — one override per pair. The
-- data-layer write does an upsert, so saving an existing combo just
-- updates the gross_amount.

CREATE TABLE IF NOT EXISTS period_pay_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  pay_period_id   uuid NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  gross_amount    numeric(12, 2) NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS period_pay_overrides_company_idx
  ON period_pay_overrides (company_id);

CREATE INDEX IF NOT EXISTS period_pay_overrides_period_idx
  ON period_pay_overrides (pay_period_id);

CREATE UNIQUE INDEX IF NOT EXISTS period_pay_overrides_emp_period_uq
  ON period_pay_overrides (employee_id, pay_period_id);
