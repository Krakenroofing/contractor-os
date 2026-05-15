-- Reconciliation Matching — Phase 1 (a.k.a. spec Phase 3).
--
-- IMPORTANT: Run this against the production Supabase database BEFORE
-- deploying the code that references this table. Every statement is additive
-- and idempotent.
--
-- Operator run path:
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the verification SELECTs return the new table + new column.
--   4. Deploy.
--
-- Scope: link imported bank transactions to existing financial records
-- (invoice_payments, receipts, job_cost_entries, transfers, owner equity).
-- Read-only on the matched-target side — the match table records the link
-- and is the single source of truth for "is this txn reconciled?".

-- ===========================================================================
-- 1. transaction_matches
-- ===========================================================================
-- One row per match attempt. `reversed_at` is set on Unmatch — never deletes.
-- Each target lives in a different table; we use a column-per-type and a
-- match_type tag rather than polymorphic FKs so existing FK semantics carry
-- the integrity for us.
CREATE TABLE IF NOT EXISTS public.transaction_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  imported_transaction_id uuid NOT NULL REFERENCES public.imported_transactions(id) ON DELETE CASCADE,

  -- 'invoice_payment' | 'receipt' | 'job_cost_entry' | 'transfer'
  -- | 'owner_contribution' | 'owner_draw'
  match_type text NOT NULL,

  -- Exactly one of the following is non-null (for record-targeted match
  -- types). Owner draws/contributions populate none.
  invoice_payment_id uuid REFERENCES public.invoice_payments(id) ON DELETE CASCADE,
  receipt_id uuid REFERENCES public.receipts(id) ON DELETE CASCADE,
  job_cost_entry_id uuid REFERENCES public.job_cost_entries(id) ON DELETE CASCADE,
  -- For transfers: the OTHER bank transaction. The pair is symmetric — both
  -- rows reference each other through their own match rows.
  transfer_paired_txn_id uuid REFERENCES public.imported_transactions(id) ON DELETE CASCADE,

  -- 'exact' | 'high' | 'low' | 'manual'
  confidence text NOT NULL DEFAULT 'manual',
  matched_at timestamptz NOT NULL DEFAULT now(),
  matched_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes text,

  reversed_at timestamptz,
  reversed_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transaction_matches_company_idx
  ON public.transaction_matches(company_id);

-- One ACTIVE match per imported transaction. A reversed match is fine — the
-- partial index ignores it.
CREATE UNIQUE INDEX IF NOT EXISTS transaction_matches_txn_active_uniq
  ON public.transaction_matches(company_id, imported_transaction_id)
  WHERE reversed_at IS NULL;

-- One ACTIVE match per target record. Separate partial unique indexes per
-- target column so the same target can't be claimed by two bank txns at once.
CREATE UNIQUE INDEX IF NOT EXISTS transaction_matches_invoice_payment_uniq
  ON public.transaction_matches(company_id, invoice_payment_id)
  WHERE reversed_at IS NULL AND invoice_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS transaction_matches_receipt_uniq
  ON public.transaction_matches(company_id, receipt_id)
  WHERE reversed_at IS NULL AND receipt_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS transaction_matches_jce_uniq
  ON public.transaction_matches(company_id, job_cost_entry_id)
  WHERE reversed_at IS NULL AND job_cost_entry_id IS NOT NULL;

-- Transfer pairing: each side of the pair has its own match row. A given
-- bank-txn can only be paired with one other bank-txn at a time.
CREATE UNIQUE INDEX IF NOT EXISTS transaction_matches_transfer_uniq
  ON public.transaction_matches(company_id, transfer_paired_txn_id)
  WHERE reversed_at IS NULL AND transfer_paired_txn_id IS NOT NULL;

-- ===========================================================================
-- 2. imported_transactions.reconciled_at
-- ===========================================================================
-- Denormalized view of "has an active match row?". Computed and kept in sync
-- by the match/unmatch server actions. Lets the UI render the reconciled
-- badge without joining transaction_matches per row.
ALTER TABLE public.imported_transactions
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

CREATE INDEX IF NOT EXISTS imported_transactions_reconciled_idx
  ON public.imported_transactions(company_id, reconciled_at)
  WHERE reconciled_at IS NOT NULL;

-- ===========================================================================
-- Verification
-- ===========================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'transaction_matches';

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'imported_transactions'
  AND column_name = 'reconciled_at';

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'transaction_matches'
ORDER BY indexname;
