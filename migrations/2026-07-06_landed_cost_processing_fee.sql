-- ===========================================================================
-- Landed cost: Bahamas Customs Processing Fee (1% of goods value, cap $1,000)
-- ===========================================================================
-- The estimator was missing the customs Processing Fee entirely. It appears on
-- every real Pinder's import summary: 1% of the goods (FOB) value, capped at
-- $1,000 (confirmed across 32 shipments; shipment 1020240 hit the cap exactly).
-- It is now added to the landed-cost total and folded into the VAT base.
--
-- Three columns: the rate + cap (so an entry keeps its assumptions) and the
-- computed amount. Existing rows default to 1% / $1,000 / $0 — their stored
-- totals are unchanged until re-saved, at which point the fee is applied.
--
-- Ordering: run THIS migration in Supabase first, THEN deploy the app code
-- (the landed-cost form/detail/list read these columns).
--
-- Plain ADD COLUMN (safe in a transaction). IF NOT EXISTS makes it re-runnable.

ALTER TABLE landed_costs
  ADD COLUMN IF NOT EXISTS processing_fee_percent numeric(6,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS processing_fee_cap numeric(14,2) NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS processing_fee_amount numeric(14,2) NOT NULL DEFAULT 0;
