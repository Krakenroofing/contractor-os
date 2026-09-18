-- Match a bank withdrawal to the customer refund it paid.
--
-- A credit memo applied as a cash_refund leaves the building as real money.
-- Until now the only way to account for that withdrawal was to categorize it
-- to a revenue account, which made the P&L count the same refund twice: once
-- through the credit-memo contra and again through the bank-deposit income
-- source. Linking the transaction to the credit memo puts it in one lane.

ALTER TABLE transaction_matches
  ADD COLUMN IF NOT EXISTS credit_memo_id uuid
    REFERENCES credit_memos(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS transaction_matches_credit_memo_idx
  ON transaction_matches (credit_memo_id)
  WHERE credit_memo_id IS NOT NULL;

-- One active refund match per credit memo, so a memo can't be settled twice.
CREATE UNIQUE INDEX IF NOT EXISTS transaction_matches_credit_memo_active_uniq
  ON transaction_matches (company_id, credit_memo_id)
  WHERE reversed_at IS NULL AND credit_memo_id IS NOT NULL;
