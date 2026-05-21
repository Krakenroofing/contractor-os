-- Phase 1 of payroll: employees as first-class records.
--
-- Employees are distinct from `users` (login accounts) and `vendors`
-- (external companies). NIB calculations, timesheets, and paystubs key
-- off this table. Soft-delete via `deleted_at` so history survives
-- terminations.

CREATE TABLE IF NOT EXISTS employees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  nib_number      text,
  email           text,
  phone           text,
  -- 'hourly' (pay_rate = $/hour) or 'salaried' (pay_rate = $/week).
  -- More types can be added later without a schema change.
  employment_type text NOT NULL DEFAULT 'hourly',
  pay_rate        numeric(12, 4) NOT NULL DEFAULT 0,
  hire_date       date,
  termination_date date,
  active          boolean NOT NULL DEFAULT true,
  notes           text,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employees_company_idx
  ON employees (company_id);

CREATE INDEX IF NOT EXISTS employees_active_idx
  ON employees (company_id, active);
