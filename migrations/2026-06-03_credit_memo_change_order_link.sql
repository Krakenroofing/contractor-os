-- Link a refund credit memo to the deduct change order it spawned.
--
-- When a cash refund is issued for a canceled / reduced scope, the operator
-- can record a matching negative (deduct) change order that lowers the
-- project's revised contract value. credit_memos.change_order_id ties the two
-- together so reporting can also net the refunded amount out of the project's
-- billed-net — otherwise "still billable" (revised contract − billed net) goes
-- negative by the refund, because the original invoice stays intact at full
-- value while the contract drops.
--
-- NULL for goodwill / pricing-correction credits: those neither reduce the
-- contract nor net out of billed.
--
-- Additive + nullable, so this is safe to run before the matching deploy.

ALTER TABLE credit_memos
  ADD COLUMN IF NOT EXISTS change_order_id uuid
    REFERENCES change_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS credit_memos_change_order_idx
  ON credit_memos(change_order_id);
