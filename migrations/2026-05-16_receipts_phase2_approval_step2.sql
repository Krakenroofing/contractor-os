-- Receipts — Phase 2.2: Approval workflow — STEP 2 of 2.
--
-- Run ONLY after 2026-05-16_receipts_phase2_approval.sql has completed
-- successfully (that file adds the 'submitted' value to receipt_status).
-- This file adds the audit columns and verifies everything.
--
-- Operator run path:
--   1. Confirm step 1 succeeded.
--   2. Supabase Dashboard → SQL Editor → New query.
--   3. Paste this file → Run.
--   4. Confirm the two verification SELECTs at the bottom show 4 enum
--      values and 5 audit columns.

-- ===========================================================================
-- Audit columns
-- ===========================================================================
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- ===========================================================================
-- Verification
-- ===========================================================================

-- Enum should now list draft / submitted / posted / void.
SELECT unnest(enum_range(NULL::receipt_status))::text AS receipt_status_value
ORDER BY 1;

-- All five new columns should appear.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'receipts'
  AND column_name IN (
    'submitted_at',
    'submitted_by_user_id',
    'approved_at',
    'approved_by_user_id',
    'rejection_reason'
  )
ORDER BY column_name;
