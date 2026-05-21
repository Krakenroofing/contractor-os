-- Phase 4.5: extend the employee record.
--
-- Adds a NIB exemption flag so expats and others who don't have NIB
-- withheld can be flagged at the employee level. When true:
--   - Their paystub shows gross + net (no NIB lines).
--   - They drop off the C17 NIB filing summary entirely.
--   - The employer NIB cost line is also zero for them.
--
-- employment_type is already a text column. The four new values
-- (piecework, contract, commission, lump_sum) need no SQL change —
-- validation is enforced at the app layer.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS nib_exempt boolean NOT NULL DEFAULT false;
