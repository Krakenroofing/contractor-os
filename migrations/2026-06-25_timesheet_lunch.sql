-- Unpaid lunch breaks on the timesheet.
--
-- The deduction defaults by the day's hours (Bahamas practice): 60 min if the
-- employee worked >= 6 hours that day, 30 min if under 6, 0 if no hours. That
-- default is COMPUTED — we only store a row here when a day's lunch is edited
-- away from the default (including to 0, i.e. "no lunch"). One row per
-- (employee, work_date).

CREATE TABLE IF NOT EXISTS timesheet_lunch_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  pay_period_id uuid NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  minutes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS timesheet_lunch_overrides_period_idx
  ON timesheet_lunch_overrides (pay_period_id);
