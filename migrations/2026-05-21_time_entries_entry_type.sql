-- Phase 4.7: time entries gain an entry_type so the same table can hold
-- both classic timesheet rows ("Mike worked 8 hours") and direct
-- pay-amount rows ("Sarah earned $500 in commission Tuesday"). The
-- timesheet UI then becomes a single entry point regardless of how the
-- employee gets paid — picking the employee tells the form which mode
-- it's in.
--
-- entry_type='hours' (default, backwards-compatible for every existing
-- row): hours field carries the value, amount stays at 0. Pay derives
-- from hours × employee.pay_rate.
--
-- entry_type='amount': amount carries the pay, hours stays at 0. Pay
-- is the amount directly (sum across the period becomes gross).

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'hours';

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS amount numeric(12, 2) NOT NULL DEFAULT 0;

-- Existing hours column was not-null with no default; lock that down so
-- new inserts don't fail when the application sends only an amount row.
ALTER TABLE time_entries
  ALTER COLUMN hours SET DEFAULT 0;
