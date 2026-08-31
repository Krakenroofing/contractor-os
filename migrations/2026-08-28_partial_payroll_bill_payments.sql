-- Partial payroll-bill payments: a payment can settle PART of a payroll
-- bill (employee owed 1,000, paid 100 now). The match row records how much
-- of the bill this payment covers; NULL = the full bill amount (legacy rows
-- and receipt matches keep their existing semantics).
--
-- Run in the Supabase SQL editor BEFORE deploying the application code.

ALTER TABLE transaction_matches
  ADD COLUMN IF NOT EXISTS matched_amount numeric(14, 2);

-- A payroll bill may now be settled by SEVERAL payments (one active match
-- per bill+transaction pair, instead of one per bill).
DROP INDEX IF EXISTS transaction_matches_payroll_bill_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS transaction_matches_payroll_bill_txn_uniq
  ON transaction_matches (company_id, payroll_bill_id, imported_transaction_id)
  WHERE reversed_at IS NULL AND payroll_bill_id IS NOT NULL;

-- Verification
SELECT column_name FROM information_schema.columns
WHERE table_name = 'transaction_matches' AND column_name = 'matched_amount';
