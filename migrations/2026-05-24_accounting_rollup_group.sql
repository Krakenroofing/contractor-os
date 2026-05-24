-- Operational accounting Phase 1: rollup_group classifier.
--
-- The existing `accounting_accounts.type` enum is mostly about HOW the
-- account is used (cogs_job_cost, vat_payable, bank, credit_card, etc.).
-- For real financial reporting we also need to classify each account into
-- one of the standard 7 financial-statement groups so the P&L, dashboard
-- tiles, and future rollups can `GROUP BY rollup_group` without having to
-- pattern-match on names or walk the parent_id tree.
--
-- rollup_group is the CONCEPTUAL classification:
--   income   — every revenue account (Roofing Revenue, Service Revenue, ...)
--   cogs     — Cost of Goods Sold lines (Roofing Materials, Direct Labor,
--              Expat Housing, Per Diem, Crane Rental, Subcontractors, ...)
--   opex     — Operating Expense lines (Office Rent, Software, Insurance, ...)
--   asset    — Asset accounts (bank accounts, equipment, deposits, ...)
--   liability — Liability accounts (credit cards, AP, accruals, ...)
--   equity    — Owner equity / retained earnings
--   vat_tax   — VAT-payable and VAT-input pools (kept separate from regular
--               liabilities/assets so VAT reporting can stay clean)
--
-- Hierarchy is via the existing parent_id (parent_id IS NULL = section
-- header like "Cost of Goods Sold"; non-null = operational line under it).
--
-- Safe migration: NOT NULL with a sensible backfill from the existing type
-- enum. No data loss, no rename, no orphan rows.

CREATE TYPE account_rollup_group AS ENUM (
  'income',
  'cogs',
  'opex',
  'asset',
  'liability',
  'equity',
  'vat_tax'
);

ALTER TABLE accounting_accounts
  ADD COLUMN rollup_group account_rollup_group;

-- Backfill from the existing type enum. Anything we can't classify falls
-- back to opex — it's the safest bucket for an unclassified expense.
UPDATE accounting_accounts SET rollup_group =
  CASE type
    WHEN 'bank'                  THEN 'asset'::account_rollup_group
    WHEN 'credit_card'           THEN 'liability'::account_rollup_group
    WHEN 'income'                THEN 'income'::account_rollup_group
    WHEN 'uncategorized_income'  THEN 'income'::account_rollup_group
    WHEN 'expense'               THEN 'opex'::account_rollup_group
    WHEN 'uncategorized_expense' THEN 'opex'::account_rollup_group
    WHEN 'cogs_job_cost'         THEN 'cogs'::account_rollup_group
    WHEN 'vat_payable'           THEN 'vat_tax'::account_rollup_group
    WHEN 'vat_input'             THEN 'vat_tax'::account_rollup_group
    WHEN 'owner_equity'          THEN 'equity'::account_rollup_group
    ELSE 'opex'::account_rollup_group
  END;

-- Enforce NOT NULL after backfill so every account is classified.
ALTER TABLE accounting_accounts
  ALTER COLUMN rollup_group SET NOT NULL;

CREATE INDEX IF NOT EXISTS accounting_accounts_company_rollup_idx
  ON accounting_accounts (company_id, rollup_group);
