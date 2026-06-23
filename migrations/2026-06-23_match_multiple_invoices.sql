-- Allow a single bank deposit to be matched to MULTIPLE invoice payments
-- (a lump customer payment that settles several invoices at once — e.g. a
-- $110,695.18 deposit covering invoices 6029 + 6032).
--
-- The "one active match per bank transaction" rule still holds for EVERY
-- OTHER match type (transfer, owner contribution/draw, receipt, job cost):
-- those remain strictly one-per-txn. Only invoice_payment may repeat on the
-- same transaction. Each invoice payment is still matched at most once,
-- enforced by transaction_matches_invoice_payment_uniq (unchanged).

DROP INDEX IF EXISTS transaction_matches_txn_active_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS transaction_matches_txn_active_uniq
  ON public.transaction_matches(company_id, imported_transaction_id)
  WHERE reversed_at IS NULL AND match_type <> 'invoice_payment';

-- Helps the per-txn "what's already allocated" lookup when building the
-- multi-invoice match panel.
CREATE INDEX IF NOT EXISTS transaction_matches_txn_active_idx
  ON public.transaction_matches(company_id, imported_transaction_id)
  WHERE reversed_at IS NULL;
