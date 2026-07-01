-- Widen paystub_adjustments.type to allow 'bonus'.
--
-- The 'bonus' type was added in code (src/db/schema/paystub-adjustments.ts,
-- the adjustments editor, and payroll-math) as a post-NIB, NIB-exempt
-- addition — "paid NIB-free per operator" — but the DB CHECK constraint
-- was never widened to match, so every "Add Bonus" insert failed with
-- paystub_adjustments_type_check. This realigns the constraint with the
-- shipped code.
--
-- Idempotent: drop-if-exists then re-add the full type list.

ALTER TABLE paystub_adjustments
  DROP CONSTRAINT IF EXISTS paystub_adjustments_type_check;

ALTER TABLE paystub_adjustments
  ADD CONSTRAINT paystub_adjustments_type_check
  CHECK (type IN ('deduction', 'reimbursement', 'per_diem', 'expense', 'bonus'));
