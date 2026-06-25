-- Accounting settings: company-level policy toggles surfaced in the new
-- Accounting Settings menu (/settings/accounting).
--
--  * default_retainage_percent — auto-fills the retainage % on a new invoice
--    when there's no prior invoice on the project to copy from. 0 = none.
--  * retainage_revenue_basis — when held retainage hits the P&L income:
--      'billed'  = recognize net-of-retainage now, the held part at release
--                  (current behavior — the basis chosen 2026-06-25).
--      'accrual' = recognize the full contract value when first billed.
--
-- Both additive with defaults that preserve current behavior → safe to run
-- before the matching deploy.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS default_retainage_percent numeric(6,3) NOT NULL DEFAULT 0;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS retainage_revenue_basis text NOT NULL DEFAULT 'billed';

ALTER TABLE companies
  DROP CONSTRAINT IF EXISTS companies_retainage_revenue_basis_check;
ALTER TABLE companies
  ADD CONSTRAINT companies_retainage_revenue_basis_check
  CHECK (retainage_revenue_basis IN ('billed', 'accrual'));
