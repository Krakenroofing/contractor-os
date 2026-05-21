-- Phase 2 of payroll: pay periods + time entries.
--
-- Pay periods are weekly Mon–Sun buckets. They're created on demand the
-- first time someone enters time inside the week, so we don't need a cron
-- to materialize empty future periods. Once "locked", entries inside the
-- period can no longer be edited — this is the close-out signal for
-- downstream NIB filing.
--
-- time_entries is the source of truth for payroll hours: one row per
-- (employee, date, optional project). The "general timesheet" view pivots
-- by employee × day; the "by job" view groups by project. Same data, two
-- pivots.
--
-- This table is distinct from job_costs.labor_entries (which carry
-- worker_name as a string). Both continue to work; unification is a Phase
-- 5 polish item.

CREATE TABLE IF NOT EXISTS pay_periods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  -- 'open' | 'locked'
  status      text NOT NULL DEFAULT 'open',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pay_periods_company_idx
  ON pay_periods (company_id);

-- One period per (company, start_date) — the lookup key when "find or
-- create the period containing 2026-05-19" runs.
CREATE UNIQUE INDEX IF NOT EXISTS pay_periods_company_start_uq
  ON pay_periods (company_id, start_date);

CREATE TABLE IF NOT EXISTS time_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  pay_period_id  uuid NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  work_date      date NOT NULL,
  hours          numeric(7, 2) NOT NULL,
  project_id     uuid REFERENCES projects(id) ON DELETE SET NULL,
  cost_code_id   uuid REFERENCES cost_codes(id) ON DELETE SET NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_entries_company_idx
  ON time_entries (company_id);

CREATE INDEX IF NOT EXISTS time_entries_period_idx
  ON time_entries (pay_period_id);

CREATE INDEX IF NOT EXISTS time_entries_employee_idx
  ON time_entries (employee_id);

CREATE INDEX IF NOT EXISTS time_entries_project_idx
  ON time_entries (project_id);
