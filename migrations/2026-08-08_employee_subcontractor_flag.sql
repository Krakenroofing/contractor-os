-- Subcontractor classification for payroll workers.
--
-- Some hourly crew (typically NIB-exempt, "(ES)" names in the old QB file)
-- are economically subcontractors: they run through payroll for time/pay
-- mechanics, but their cost belongs under the Subcontractors COGS category
-- (QB account 53600), not Direct Labor / Payroll Expenses. This flag routes
-- their labor everywhere cost is booked: job-cost labor posting, the P&L
-- payroll expense source, and payroll-bill GL lines.

ALTER TABLE public.employees
  ADD COLUMN is_subcontractor boolean NOT NULL DEFAULT false;
