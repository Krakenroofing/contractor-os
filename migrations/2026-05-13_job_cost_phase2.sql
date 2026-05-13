-- Job Costing Phase 2: specialized labor/equipment/vendor-expense entries
-- and per-cost-code cost-to-complete forecasts.
--
-- Design decision (per user spec): keep ONE flexible job_cost_entries table,
-- add small targeted metadata columns. Labor burden and vendor invoice number
-- are the only specialized fields that don't fit cleanly in
-- description/notes/quantity/unit_cost, so they get dedicated columns.
--
-- Forecasts get their own table — one row per (project, cost_code) with
-- cost_to_complete + notes + risk flag. Joined into financials so Projected
-- Final Cost = Actual To Date + sum(cost_to_complete).
--
-- IMPORTANT: Run this against production Supabase BEFORE deploying code.
-- Additive and idempotent.

-- ===========================================================================
-- Two metadata columns on job_cost_entries
-- ===========================================================================

-- Labor burden % — added to the line amount when the labor form computes
-- total = hours * rate * (1 + burden_percent/100). NULL for non-labor rows.
ALTER TABLE public.job_cost_entries
  ADD COLUMN IF NOT EXISTS burden_percent numeric(6, 3);

-- Vendor invoice number — lets the vendor-expense form record the source
-- invoice so future duplicate-detection and AP reconciliation have a hook.
-- NULL for non-vendor-bill rows.
ALTER TABLE public.job_cost_entries
  ADD COLUMN IF NOT EXISTS vendor_invoice_number text;

-- ===========================================================================
-- job_cost_forecasts — one row per (project, cost_code)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.job_cost_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cost_code_id uuid NOT NULL REFERENCES public.cost_codes(id) ON DELETE RESTRICT,
  cost_to_complete numeric(14, 2) NOT NULL DEFAULT 0,
  notes text,
  risk_flag boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS job_cost_forecasts_project_idx
  ON public.job_cost_forecasts(project_id);
CREATE INDEX IF NOT EXISTS job_cost_forecasts_company_idx
  ON public.job_cost_forecasts(company_id);

-- One non-deleted forecast per (project, cost_code). Soft-deleted rows
-- are excluded so a PM can clear & re-add without a hard delete.
CREATE UNIQUE INDEX IF NOT EXISTS job_cost_forecasts_project_code_uniq
  ON public.job_cost_forecasts(project_id, cost_code_id)
  WHERE deleted_at IS NULL;

-- ===========================================================================
-- Verification
-- ===========================================================================

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'job_cost_entries'
  AND column_name IN ('burden_percent', 'vendor_invoice_number')
ORDER BY column_name;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'job_cost_forecasts';
