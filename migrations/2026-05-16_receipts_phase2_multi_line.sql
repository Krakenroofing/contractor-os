-- Receipts — Phase 2.1: Multi-line split.
--
-- IMPORTANT: Run this against the production Supabase database BEFORE
-- deploying the code that references receipt_lines. Every statement is
-- additive and idempotent.
--
-- Operator run path:
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the verification SELECTs at the bottom show:
--      - receipt_lines table exists
--      - every non-void receipt has at least one row in receipt_lines
--   4. Then deploy the application code.
--
-- Scope summary:
--   - New table: receipt_lines (1..N per receipt)
--   - Backfill: every non-void receipt gets one line cloned from header
--     fields (project_id, cost_code_id, accounting_account_id, cost_type,
--     is_billable, is_reimbursable, subtotal, vat_amount, total,
--     vat_rate_percent, posted_job_cost_entry_id).
--   - Header columns project_id, cost_code_id, accounting_account_id,
--     cost_type, is_billable, is_reimbursable, posted_job_cost_entry_id
--     stay in place but are deprecated. App code reads from receipt_lines.
--     A future cleanup migration will drop them.
--   - receipts.subtotal/vat_amount/total stay as denormalized sums of
--     line totals — the app keeps them in sync on every line write.

-- ===========================================================================
-- 1. receipt_lines
-- ===========================================================================
-- Money: numeric(14, 2) — same precision as receipts/job_cost_entries.
-- vat_rate_percent on the line is an optional override; null means inherit
-- from the receipt header. Posting (per-line) writes ONE row into
-- job_cost_entries with source='receipt_import' and source_ref_id =
-- receipts.id. The 1:1 link is captured in posted_job_cost_entry_id.
CREATE TABLE IF NOT EXISTS public.receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,

  sort_order integer NOT NULL DEFAULT 0,

  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  cost_code_id uuid REFERENCES public.cost_codes(id) ON DELETE SET NULL,
  accounting_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,

  -- Free-form override matching the job_cost_type enum at the app layer.
  cost_type text,
  description text,

  subtotal numeric(14, 2) NOT NULL DEFAULT 0,
  vat_amount numeric(14, 2) NOT NULL DEFAULT 0,
  total numeric(14, 2) NOT NULL DEFAULT 0,
  vat_rate_percent numeric(6, 3),

  is_billable boolean NOT NULL DEFAULT false,
  is_reimbursable boolean NOT NULL DEFAULT false,

  posted_job_cost_entry_id uuid REFERENCES public.job_cost_entries(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS receipt_lines_receipt_idx
  ON public.receipt_lines(receipt_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS receipt_lines_company_idx
  ON public.receipt_lines(company_id);
CREATE INDEX IF NOT EXISTS receipt_lines_project_idx
  ON public.receipt_lines(project_id)
  WHERE project_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS receipt_lines_posted_jce_idx
  ON public.receipt_lines(posted_job_cost_entry_id)
  WHERE posted_job_cost_entry_id IS NOT NULL;

-- ===========================================================================
-- 2. Backfill: one line per existing non-void receipt
-- ===========================================================================
-- We only backfill receipts that don't already have lines (the migration is
-- re-runnable). The clone preserves the posted link so unpost continues to
-- work on previously-posted receipts.
INSERT INTO public.receipt_lines (
  company_id,
  receipt_id,
  sort_order,
  project_id,
  cost_code_id,
  accounting_account_id,
  cost_type,
  description,
  subtotal,
  vat_amount,
  total,
  vat_rate_percent,
  is_billable,
  is_reimbursable,
  posted_job_cost_entry_id,
  created_at,
  updated_at
)
SELECT
  r.company_id,
  r.id,
  0,
  r.project_id,
  r.cost_code_id,
  r.accounting_account_id,
  r.cost_type,
  NULL, -- description: header had no per-line description
  r.subtotal,
  r.vat_amount,
  r.total,
  r.vat_rate_percent,
  r.is_billable,
  r.is_reimbursable,
  r.posted_job_cost_entry_id,
  r.created_at,
  r.updated_at
FROM public.receipts r
WHERE r.status <> 'void'
  AND r.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.receipt_lines rl
    WHERE rl.receipt_id = r.id AND rl.deleted_at IS NULL
  );

-- ===========================================================================
-- Verification
-- ===========================================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'receipt_lines';

-- Every non-void receipt should have ≥1 line after backfill.
SELECT
  COUNT(*) FILTER (
    WHERE NOT EXISTS (
      SELECT 1 FROM public.receipt_lines rl
      WHERE rl.receipt_id = r.id AND rl.deleted_at IS NULL
    )
  ) AS receipts_missing_lines,
  COUNT(*) AS total_non_void_receipts
FROM public.receipts r
WHERE r.status <> 'void' AND r.deleted_at IS NULL;
