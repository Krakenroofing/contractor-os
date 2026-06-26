-- Allow ONE bank withdrawal to be matched to MULTIPLE bills (posted receipts)
-- — a batch bill payment that settles several vendor bills at once, plus a
-- bank-fee line for the difference. Mirrors the multi-invoice deposit match on
-- the AR side.
--
-- The "one active match per bank transaction" rule still holds for transfers,
-- owner contribution/draw, and job-cost matches. Only invoice_payment (AR) and
-- now receipt (AP bills) may repeat on the same transaction.

DROP INDEX IF EXISTS transaction_matches_txn_active_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS transaction_matches_txn_active_uniq
  ON public.transaction_matches(company_id, imported_transaction_id)
  WHERE reversed_at IS NULL
    AND match_type NOT IN ('invoice_payment', 'receipt');
