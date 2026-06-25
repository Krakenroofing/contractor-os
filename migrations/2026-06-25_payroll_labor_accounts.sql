-- Payroll → job costs: the two accounting accounts a posted pay period maps to.
--   labor_cogs_account_id   — direct labor (wages) → COGS
--   labor_burden_account_id — employer NIB / payroll burden → separate account
-- Both nullable; posting refuses until they're set on Settings → Accounting.
-- Additive, defaulted null → safe to run before the matching deploy.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS labor_cogs_account_id uuid
    REFERENCES accounting_accounts(id) ON DELETE SET NULL;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS labor_burden_account_id uuid
    REFERENCES accounting_accounts(id) ON DELETE SET NULL;
