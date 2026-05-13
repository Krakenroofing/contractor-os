-- Job Costing Phase 1: extend `job_cost_entries` so manual costs can finally
-- be entered through the UI.
--
-- The table already existed but had no cost-type column (only the
-- cost_code.category coarsely tagged labor/material/etc), no billable flag,
-- no markup, and no soft-delete. All four are needed for Phase 1 to be useful
-- and for Phases 2-4 to layer on top without further schema changes.
--
-- IMPORTANT: Run this against the production Supabase database BEFORE
-- deploying the application code. Every statement is additive and idempotent.
--
-- Operator run path:
--   1. Supabase Dashboard → SQL Editor → New query → paste & run.
--   2. Confirm the verification block at the bottom shows the new enum and
--      the three new columns.
--   3. Then deploy the application code.

-- ===========================================================================
-- Enum: 17 cost types (16 from spec + 'change_order_work')
-- ===========================================================================

DO $$ BEGIN
  CREATE TYPE job_cost_type AS ENUM (
    'labor',
    'labor_burden',
    'materials',
    'subcontractor',
    'equipment_rental',
    'owned_equipment',
    'freight',
    'customs_duty',
    'vat',
    'tools_consumables',
    'fuel_travel',
    'per_diem_housing',
    'permits_fees',
    'disposal',
    'general_conditions',
    'change_order_work',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- New columns on job_cost_entries
-- ===========================================================================

ALTER TABLE public.job_cost_entries
  ADD COLUMN IF NOT EXISTS cost_type job_cost_type NOT NULL DEFAULT 'other';

ALTER TABLE public.job_cost_entries
  ADD COLUMN IF NOT EXISTS is_billable boolean NOT NULL DEFAULT false;

ALTER TABLE public.job_cost_entries
  ADD COLUMN IF NOT EXISTS markup_percent numeric(6, 3);

-- Soft-delete column. Lets the UI hide / restore entries without losing audit
-- trail. Nullable timestamp; queries filter `deleted_at IS NULL`.
ALTER TABLE public.job_cost_entries
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ===========================================================================
-- Index for cost-type reporting (Phase 4 ledger reports)
-- ===========================================================================

CREATE INDEX IF NOT EXISTS job_cost_entries_project_type_idx
  ON public.job_cost_entries(project_id, cost_type)
  WHERE deleted_at IS NULL;

-- ===========================================================================
-- Verification
-- ===========================================================================

SELECT typname FROM pg_type WHERE typname = 'job_cost_type';

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'job_cost_entries'
  AND column_name IN ('cost_type', 'is_billable', 'markup_percent', 'deleted_at')
ORDER BY column_name;
