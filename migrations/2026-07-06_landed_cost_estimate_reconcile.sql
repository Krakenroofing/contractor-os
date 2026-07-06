-- ===========================================================================
-- Landed cost: estimate → reconcile
-- ===========================================================================
-- The entry's existing columns hold the live (working / actual) figures.
-- `estimate_snapshot` freezes the line amounts as of creation so the detail
-- page can show estimate → actual → variance. `reconciled_at` stamps when the
-- actuals were confirmed against the broker documents.
--
-- Ordering: run THIS migration in Supabase first, THEN deploy the app code
-- (both columns are read by the landed-cost list/detail queries).
--
-- Plain ADD COLUMN (safe in a transaction). IF NOT EXISTS makes it re-runnable.

ALTER TABLE landed_costs
  ADD COLUMN IF NOT EXISTS estimate_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
