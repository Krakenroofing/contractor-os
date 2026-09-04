-- Employees added to payroll partway through the year: NIB coverage begins
-- on this date. Pay periods ENDING before it compute with no NIB (as if
-- exempt, off the C-10); periods ending on/after it calculate NIB normally.
-- Null = covered from the start. nib_exempt=true still overrides entirely.
alter table employees add column if not exists nib_start_date date;

comment on column employees.nib_start_date is
  'NIB coverage start: pay periods ending before this date compute with no NIB (treated as exempt, excluded from C-10). Null = covered from first pay week.';
