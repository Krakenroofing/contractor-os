-- Phase 2: Backfill invoice/payment reconciliation for legacy invoices.
--
-- Background: prior to the payment-driven AR fix, "Mark Paid" flipped
-- invoices.status='paid' without recording a payment row. The dashboard
-- now derives outstanding AR from `invoice_payments`, so any historical
-- invoice with status='paid' (or 'partial') that lacks a matching payment
-- row will now show as outstanding. This script reconciles those rows.
--
-- Idempotent: every insert is keyed on `payment_number = 'BACKFILL-' || number`
-- so re-running is a no-op. The unique index on `invoice_payments.payment_number`
-- (when non-empty) prevents duplicates.
--
-- Apply this against the production Supabase database BEFORE redeploying.
--
-- Run path:
--   1. Open Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the SELECTs at the bottom show consistent numbers.

-- ===========================================================================
-- Step 1: insert balancing payment rows for invoices whose amount_paid
-- exceeds the sum of recorded payments. Uses a deterministic payment_number
-- so re-runs are no-ops.
-- ===========================================================================

WITH paid_sums AS (
  SELECT
    p.invoice_id,
    SUM(p.amount)::numeric AS recorded_paid
  FROM public.invoice_payments p
  WHERE p.status IN ('received', 'applied')
  GROUP BY p.invoice_id
),
gaps AS (
  SELECT
    i.id            AS invoice_id,
    i.number        AS invoice_number,
    i.invoice_date  AS invoice_date,
    i.amount_paid::numeric AS cached_paid,
    COALESCE(ps.recorded_paid, 0) AS recorded_paid,
    i.total::numeric AS total,
    i.status        AS status
  FROM public.invoices i
  LEFT JOIN paid_sums ps ON ps.invoice_id = i.id
  WHERE i.status <> 'void'
    AND (
      -- Cache says paid > what payments record, by more than half a cent.
      i.amount_paid::numeric > COALESCE(ps.recorded_paid, 0) + 0.005
      OR
      -- Status says paid but the cache is also short — derive from total.
      (i.status = 'paid'
        AND i.total::numeric > COALESCE(ps.recorded_paid, 0) + 0.005)
    )
)
INSERT INTO public.invoice_payments (
  invoice_id,
  payment_number,
  paid_date,
  amount,
  method,
  reference,
  bank_account,
  status,
  notes
)
SELECT
  g.invoice_id,
  'BACKFILL-' || g.invoice_number AS payment_number,
  g.invoice_date AS paid_date,
  -- Reconcile to whichever target is larger: the cached `amount_paid` (so we
  -- preserve user intent for "this invoice was paid") OR, if status='paid',
  -- the full total. Subtract whatever's already recorded.
  GREATEST(
    g.cached_paid - g.recorded_paid,
    CASE WHEN g.status = 'paid' THEN g.total - g.recorded_paid ELSE 0 END
  )::numeric(14, 2) AS amount,
  'backfill_reconcile' AS method,
  NULL AS reference,
  NULL AS bank_account,
  'received' AS status,
  'Auto-recorded by reconciliation backfill on 2026-05-07. '
    || 'See migration 2026-05-07_phase2_invoice_reconciliation_backfill.sql.' AS notes
FROM gaps g
WHERE GREATEST(
        g.cached_paid - g.recorded_paid,
        CASE WHEN g.status = 'paid' THEN g.total - g.recorded_paid ELSE 0 END
      ) > 0.005
  AND NOT EXISTS (
    SELECT 1
    FROM public.invoice_payments x
    WHERE x.invoice_id = g.invoice_id
      AND x.payment_number = 'BACKFILL-' || g.invoice_number
  );

-- ===========================================================================
-- Step 2: re-derive amount_paid + status + paid_at on every non-void invoice
-- from the canonical payment rows. Safe to run repeatedly — same input
-- produces same output.
-- ===========================================================================

WITH sums AS (
  SELECT
    i.id AS invoice_id,
    COALESCE(SUM(
      CASE WHEN p.status IN ('received', 'applied') THEN p.amount::numeric ELSE 0 END
    ), 0) AS paid_total
  FROM public.invoices i
  LEFT JOIN public.invoice_payments p ON p.invoice_id = i.id
  WHERE i.status <> 'void'
  GROUP BY i.id
)
UPDATE public.invoices i
SET
  amount_paid = sums.paid_total::numeric(14, 2),
  status = CASE
    WHEN i.status = 'draft' THEN 'draft'
    WHEN sums.paid_total >= i.total::numeric - 0.005 AND i.total::numeric > 0 THEN 'paid'
    WHEN sums.paid_total > 0 THEN 'partial'
    -- Keep current status (sent/overdue) when nothing's been paid yet.
    ELSE i.status
  END,
  paid_at = CASE
    WHEN sums.paid_total >= i.total::numeric - 0.005 AND i.total::numeric > 0 THEN COALESCE(i.paid_at, NOW())
    ELSE NULL
  END,
  updated_at = NOW()
FROM sums
WHERE i.id = sums.invoice_id
  AND (
    -- Only touch rows whose cache or status would actually change, so the
    -- updated_at timestamps don't churn on a no-op re-run.
    i.amount_paid::numeric <> sums.paid_total::numeric(14, 2)
    OR (sums.paid_total >= i.total::numeric - 0.005 AND i.total::numeric > 0 AND i.status <> 'paid')
    OR (sums.paid_total > 0 AND sums.paid_total < i.total::numeric - 0.005 AND i.status NOT IN ('partial', 'draft'))
  );

-- ===========================================================================
-- Verification (re-run safe; expect counts to converge to zero on a clean
-- system after this migration runs).
-- ===========================================================================

SELECT 'Backfill payment rows created' AS check, COUNT(*) AS n
  FROM public.invoice_payments
  WHERE method = 'backfill_reconcile';

-- Invoices whose cache still disagrees with the sum of payment rows. Should
-- be zero after this script runs.
SELECT 'Invoices still out of sync' AS check, COUNT(*) AS n
  FROM public.invoices i
  LEFT JOIN (
    SELECT invoice_id,
      SUM(CASE WHEN status IN ('received', 'applied') THEN amount::numeric ELSE 0 END) AS paid
    FROM public.invoice_payments
    GROUP BY invoice_id
  ) p ON p.invoice_id = i.id
  WHERE i.status <> 'void'
    AND ABS(i.amount_paid::numeric - COALESCE(p.paid, 0)) > 0.005;
