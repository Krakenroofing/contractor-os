-- Bank expense splitting — Phase 3a.
--
-- IMPORTANT: Run this against the production Supabase database BEFORE
-- deploying the code that references this table. Additive and idempotent.
--
-- Operator run path:
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the verification SELECT returns 1 row (the table name).
--   4. Deploy.
--
-- Purpose: let a single bank-statement expense be split into multiple
-- category lines (QuickBooks-style), e.g. a $20 fuel payment split into
-- "Auto & Truck Expenses $18.18" + "VAT Input $1.82". A simple (unsplit)
-- transaction has zero lines and keeps using imported_transactions'
-- single accounting_account_id. When lines exist, they are the source of
-- truth and the parent's single category is cleared by the app layer.
--
-- Lines store positive magnitudes that sum to ABS(imported_transactions.amount).

CREATE TABLE IF NOT EXISTS public.imported_transaction_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  imported_transaction_id uuid NOT NULL
    REFERENCES public.imported_transactions(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  accounting_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  cost_code_id uuid REFERENCES public.cost_codes(id) ON DELETE SET NULL,
  description text,
  amount numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS imported_transaction_lines_txn_idx
  ON public.imported_transaction_lines (imported_transaction_id);

CREATE INDEX IF NOT EXISTS imported_transaction_lines_company_idx
  ON public.imported_transaction_lines (company_id);

-- ===========================================================================
-- Verification — expect 1 row: imported_transaction_lines
-- ===========================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'imported_transaction_lines';
