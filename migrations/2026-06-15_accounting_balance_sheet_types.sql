-- Balance-sheet categories: add generic asset / liability / equity leaf types.
--
-- The `account_rollup_group` enum already has asset/liability/equity/vat_tax
-- (those drive which financial-statement section an account aggregates into).
-- But the `accounting_account_type` enum — which describes HOW an account is
-- used — only had the P&L + system buckets (income, expense, cogs_job_cost,
-- owner_equity, bank, credit_card, vat_*). There was no neutral type to stamp
-- on an operator-created balance-sheet category, so the category manager was
-- hard-capped to income / cogs / opex.
--
-- These three generic types let operators create Asset, Liability and Equity
-- categories that show up in the per-transaction / per-line category picker on
-- Banking & Receipts, while the reserved system types (owner_equity, bank,
-- credit_card, vat_payable, vat_input) stay protected from manual edits.
--
-- ADD VALUE is autocommit and cannot run inside a transaction block — keep
-- these as standalone statements. IF NOT EXISTS makes the migration safe to
-- re-run.

ALTER TYPE accounting_account_type ADD VALUE IF NOT EXISTS 'asset';
ALTER TYPE accounting_account_type ADD VALUE IF NOT EXISTS 'liability';
ALTER TYPE accounting_account_type ADD VALUE IF NOT EXISTS 'equity';
