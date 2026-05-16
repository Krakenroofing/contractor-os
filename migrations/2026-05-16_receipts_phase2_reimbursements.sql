-- Receipts — Phase 2.4: Reimbursable flow.
--
-- IMPORTANT: Run against Supabase BEFORE deploying the application code.
-- All statements are additive, idempotent, and safe to re-run.
--
-- Operator run path:
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste this file → Run.
--   3. Confirm the verification SELECTs show the new table + columns.
--   4. Then deploy.
--
-- Scope:
--   - New table: receipt_reimbursement_payouts (one row = one cash-out to
--     a person, covering one or more reimbursable receipt_lines).
--   - New columns on receipt_lines: paid_by_user_id (who's owed) +
--     reimbursement_payout_id (FK to the payout row, null = unpaid).
--   - No changes to receipts header.

-- ===========================================================================
-- 1. receipt_reimbursement_payouts
-- ===========================================================================
-- Money: numeric(14, 2) — same precision as receipts/lines.
-- amount is the sum of line totals (gross) for every line linked via
-- receipt_lines.reimbursement_payout_id at the moment of payout.
CREATE TABLE IF NOT EXISTS public.receipt_reimbursement_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  paid_to_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,

  paid_at date NOT NULL,
  -- Free-form: "Check", "ACH", "Cash", "Venmo", etc. Stored as text to keep
  -- the schema simple — the app surfaces a small dropdown of common values.
  paid_via text NOT NULL,
  reference text,
  amount numeric(14, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  -- Bank account the money came FROM (optional — Kraken pays petty cash
  -- without a bank account ref).
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  notes text,

  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS receipt_reimbursement_payouts_company_idx
  ON public.receipt_reimbursement_payouts(company_id);
CREATE INDEX IF NOT EXISTS receipt_reimbursement_payouts_user_idx
  ON public.receipt_reimbursement_payouts(company_id, paid_to_user_id, paid_at);

-- ===========================================================================
-- 2. New columns on receipt_lines
-- ===========================================================================
ALTER TABLE public.receipt_lines
  ADD COLUMN IF NOT EXISTS paid_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reimbursement_payout_id uuid REFERENCES public.receipt_reimbursement_payouts(id) ON DELETE SET NULL;

-- Partial index for the "pending reimbursements" view — only catches
-- reimbursable lines not yet linked to a payout. Keeps the index tiny.
CREATE INDEX IF NOT EXISTS receipt_lines_pending_reimbursement_idx
  ON public.receipt_lines(company_id, paid_by_user_id)
  WHERE is_reimbursable = true
    AND reimbursement_payout_id IS NULL
    AND deleted_at IS NULL;

-- ===========================================================================
-- Verification
-- ===========================================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'receipt_reimbursement_payouts';

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'receipt_lines'
  AND column_name IN ('paid_by_user_id', 'reimbursement_payout_id')
ORDER BY column_name;
