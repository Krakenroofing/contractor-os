-- Bank statement reconciliation (QB-style).
--
-- One row per statement period per bank account: beginning balance, statement
-- ending balance + date, and a status. Transactions "cleared" in a
-- reconciliation carry its id in imported_transactions.bank_reconciliation_id
-- (NULL = uncleared / rolls forward to the next reconciliation). Completing
-- requires cleared math to tie: beginning + deposits - payments = ending.
--
-- Distinct from imported_transactions.reconciled_at, which means "matched to
-- a receipt / bill / invoice payment" (document matching), not statement
-- reconciliation.

CREATE TABLE public.bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  statement_date date NOT NULL,
  beginning_balance numeric(14,2) NOT NULL DEFAULT 0,
  ending_balance numeric(14,2) NOT NULL DEFAULT 0,
  -- 'in_progress' | 'completed'
  status text NOT NULL DEFAULT 'in_progress',
  completed_at timestamptz,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bank_reconciliations_company_idx
  ON public.bank_reconciliations(company_id);
CREATE INDEX bank_reconciliations_account_idx
  ON public.bank_reconciliations(bank_account_id, statement_date);
-- Only one open reconciliation per account at a time.
CREATE UNIQUE INDEX bank_reconciliations_one_open_uq
  ON public.bank_reconciliations(bank_account_id)
  WHERE status = 'in_progress';

-- Deny-all RLS (house pattern): the app connects as table owner and bypasses
-- RLS; this blocks the anon-key/PostgREST path.
ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

-- Cleared-in-reconciliation link. ON DELETE SET NULL so cancelling a
-- reconciliation releases its transactions back to uncleared.
ALTER TABLE public.imported_transactions
  ADD COLUMN bank_reconciliation_id uuid
  REFERENCES public.bank_reconciliations(id) ON DELETE SET NULL;

CREATE INDEX imported_transactions_bank_rec_idx
  ON public.imported_transactions(bank_reconciliation_id)
  WHERE bank_reconciliation_id IS NOT NULL;
