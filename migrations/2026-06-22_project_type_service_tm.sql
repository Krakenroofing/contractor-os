-- Service / T&M project type.
--
-- Until now every project was the same shape: a fixed contract value, change
-- orders, and progress draws (production / contract work). Service work —
-- which for both Kraken and TRB is mostly Time & Materials — doesn't fit that
-- model: there's no signed contract value, and billing comes from the labor
-- hours + materials actually spent, marked up.
--
-- This migration classifies projects without forking the table:
--
--   project_type            'production' (default, the existing behavior) or
--                           'service' (T&M work).
--   tm_labor_bill_rate      Default hourly *bill* rate for T&M labor on a
--                           service project — what the customer is charged per
--                           hour, distinct from employee pay/cost. NULL for
--                           production jobs (and overridable per-employee in a
--                           later phase).
--   tm_material_markup_pct  Default markup % applied to billable materials /
--                           job costs when generating a T&M invoice. NULL =
--                           fall back to per-entry markup / company default.
--
-- All additive + nullable (project_type has a default), so this is safe to run
-- BEFORE the matching deploy: existing rows become 'production' automatically.
--
-- Run this in Supabase before deploying the code that reads project_type.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_type') THEN
    CREATE TYPE project_type AS ENUM ('production', 'service');
  END IF;
END$$;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS project_type project_type NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS tm_labor_bill_rate numeric(12, 2),
  ADD COLUMN IF NOT EXISTS tm_material_markup_pct numeric(6, 3);

-- Filter the projects list / reports by type without scanning every row.
CREATE INDEX IF NOT EXISTS projects_company_type_idx
  ON projects(company_id, project_type);
