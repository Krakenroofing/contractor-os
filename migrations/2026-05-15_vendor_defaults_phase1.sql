-- Vendor Defaults — Phase 1.
--
-- IMPORTANT: Run this against the production Supabase database BEFORE
-- deploying the code that references these columns. Every statement is
-- additive and idempotent.
--
-- Operator run path:
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the verification SELECT returns 3 rows.
--   4. Deploy.
--
-- Purpose: per-vendor default pickers that the Receipt form reads to prefill
-- cost code / cost type / accounting category when the operator picks a
-- vendor. All three columns are nullable; existing rows are unaffected.
--
-- default_cost_type is stored as plain text — mirrors how receipts.cost_type
-- is stored. The app layer validates against the jobCostType enum value set.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS default_cost_code_id uuid
    REFERENCES public.cost_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_cost_type text,
  ADD COLUMN IF NOT EXISTS default_accounting_account_id uuid
    REFERENCES public.accounting_accounts(id) ON DELETE SET NULL;

-- ===========================================================================
-- Verification
-- ===========================================================================
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'vendors'
  AND column_name IN (
    'default_cost_code_id',
    'default_cost_type',
    'default_accounting_account_id'
  )
ORDER BY column_name;
