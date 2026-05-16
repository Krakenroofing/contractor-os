-- Receipts — Phase 2.2: Approval workflow.
--
-- IMPORTANT: Run this against the production Supabase database BEFORE
-- deploying the Phase 2.2 code. Every statement is additive and idempotent.
--
-- Operator run path:
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the verification SELECTs at the bottom show:
--      - the receipt_status enum now includes 'submitted'
--      - receipts has the 5 new audit columns
--   4. Then deploy the application code.
--
-- Scope:
--   - New enum value: receipt_status += 'submitted'. Lifecycle:
--       draft ──submit──▶ submitted ──approve & post──▶ posted
--             ◀──reject──┘
--             ◀──────────  reject also writes rejection_reason
--   - New audit columns on receipts:
--       submitted_at, submitted_by_user_id
--       approved_at,  approved_by_user_id
--       rejection_reason
--   - No backfill needed — every existing receipt is draft / posted / void
--     and stays where it is.

-- ===========================================================================
-- 1. Enum: add 'submitted' state
-- ===========================================================================
-- IF NOT EXISTS is supported on Postgres 12+ (Supabase is on 15). The whole
-- statement is a single ALTER, no DO-block needed.
ALTER TYPE receipt_status ADD VALUE IF NOT EXISTS 'submitted';

-- ===========================================================================
-- 2. Audit columns
-- ===========================================================================
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Index to power the "submitted" approver queue. Partial — only rows in
-- the submitted state count, so the index stays tiny.
CREATE INDEX IF NOT EXISTS receipts_submitted_idx
  ON public.receipts(company_id, submitted_at)
  WHERE status = 'submitted' AND deleted_at IS NULL;

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
