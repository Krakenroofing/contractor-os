-- Let a bank payment settle PAYROLL BILLS, the same way it settles vendor bills
-- (receipts). A withdrawal can match many payroll bills + many receipts + a fee.

ALTER TABLE transaction_matches
  ADD COLUMN IF NOT EXISTS payroll_bill_id uuid
    REFERENCES payroll_bills(id) ON DELETE CASCADE;

-- 'payroll_bill' joins 'invoice_payment' and 'receipt' as the match types that
-- may repeat on one bank transaction.
DROP INDEX IF EXISTS transaction_matches_txn_active_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS transaction_matches_txn_active_uniq
  ON public.transaction_matches(company_id, imported_transaction_id)
  WHERE reversed_at IS NULL
    AND match_type NOT IN ('invoice_payment', 'receipt', 'payroll_bill');

-- Each payroll bill is settled at most once.
CREATE UNIQUE INDEX IF NOT EXISTS transaction_matches_payroll_bill_uniq
  ON public.transaction_matches(company_id, payroll_bill_id)
  WHERE reversed_at IS NULL AND payroll_bill_id IS NOT NULL;
