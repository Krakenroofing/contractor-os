-- Phase 1: Daily Reports module — additive schema for project-level field reports.
--
-- Apply this against the production Supabase database BEFORE deploying the
-- code that references these tables. Every statement is additive and uses
-- IF NOT EXISTS / duplicate-object guards so it can be re-run idempotently.
--
-- Run path:
--   1. Open Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the SELECTs at the bottom show three tables and two enums.
--   4. Then deploy the application code.
--
-- Tables introduced (all keyed by project_id + scoped by company_id):
--   - daily_reports: one row per project per date (status<>'void').
--   - daily_report_manpower: crew/trade/headcount/hours per report.
--   - daily_report_photos: photo metadata; binary lives in Supabase Storage.
--
-- Storage bucket (created separately by an operator):
--   - `daily-report-photos`, PRIVATE, accessed via signed URLs server-side.
--   - Phase 1 ships schema only; photo uploads land in Phase 2.

-- ===========================================================================
-- Enums
-- ===========================================================================

DO $$ BEGIN
  CREATE TYPE daily_report_status AS ENUM (
    'draft',
    'complete',
    'exported',
    'sent_to_client',
    'void'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE daily_report_photo_category AS ENUM (
    'progress',
    'safety',
    'issue',
    'delivery',
    'inspection',
    'weather',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- daily_reports
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  report_date date NOT NULL,
  status daily_report_status NOT NULL DEFAULT 'draft',

  -- Snapshots — captured at report creation so that later edits to the
  -- project don't rewrite history on past reports.
  project_name_snapshot text,
  project_location_snapshot text,

  -- Weather (manual entry in Phase 1; auto-fetch hook lands later).
  weather_condition text,
  weather_temperature_f numeric(5, 1),
  weather_precipitation text,
  weather_wind text,
  weather_humidity text,
  weather_source text NOT NULL DEFAULT 'manual',
  weather_observed_at timestamptz,

  -- Site context
  site_conditions text,
  men_on_site integer NOT NULL DEFAULT 0,
  crew_company_name text,
  foreman_name text,

  -- Narrative fields
  work_performed text,
  materials_delivered text,
  equipment_on_site text,
  inspections text,
  delays text,
  safety_incidents text,
  visitors_on_site text,
  issues_concerns text,
  tomorrow_plan text,
  internal_notes text,
  client_notes text,

  -- Client export include-flags (per-section toggle). Internal notes are
  -- never exported; client_notes obeys its flag.
  include_weather_in_export       boolean NOT NULL DEFAULT true,
  include_manpower_in_export      boolean NOT NULL DEFAULT true,
  include_work_in_export          boolean NOT NULL DEFAULT true,
  include_materials_in_export     boolean NOT NULL DEFAULT true,
  include_equipment_in_export     boolean NOT NULL DEFAULT true,
  include_delays_in_export        boolean NOT NULL DEFAULT true,
  include_safety_in_export        boolean NOT NULL DEFAULT true,
  include_issues_in_export        boolean NOT NULL DEFAULT false,
  include_photos_in_export        boolean NOT NULL DEFAULT true,
  include_client_notes_in_export  boolean NOT NULL DEFAULT true,

  prepared_by_name text,

  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_reports_company_idx
  ON public.daily_reports(company_id);
CREATE INDEX IF NOT EXISTS daily_reports_project_idx
  ON public.daily_reports(project_id);
CREATE INDEX IF NOT EXISTS daily_reports_date_idx
  ON public.daily_reports(report_date);

-- One report per (project, date) — voided and soft-deleted rows are excluded
-- so an operator can void a mistaken report and create a new one for the
-- same day.
CREATE UNIQUE INDEX IF NOT EXISTS daily_reports_project_date_uniq
  ON public.daily_reports(project_id, report_date)
  WHERE deleted_at IS NULL AND status <> 'void';

-- ===========================================================================
-- daily_report_manpower
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.daily_report_manpower (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_report_id uuid NOT NULL REFERENCES public.daily_reports(id) ON DELETE CASCADE,
  company_crew text,
  trade text,
  worker_count integer NOT NULL DEFAULT 0,
  hours numeric(6, 2) NOT NULL DEFAULT 0,
  notes text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS daily_report_manpower_report_idx
  ON public.daily_report_manpower(daily_report_id);

-- ===========================================================================
-- daily_report_photos
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.daily_report_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_report_id uuid NOT NULL REFERENCES public.daily_reports(id) ON DELETE CASCADE,
  -- Denormalized for fast project-level photo queries without joining.
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text,
  mime_type text,
  byte_size integer,
  caption text,
  category daily_report_photo_category NOT NULL DEFAULT 'progress',
  visible_to_client boolean NOT NULL DEFAULT true,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS daily_report_photos_report_idx
  ON public.daily_report_photos(daily_report_id);
CREATE INDEX IF NOT EXISTS daily_report_photos_project_idx
  ON public.daily_report_photos(project_id);

-- ===========================================================================
-- Verification queries
-- ===========================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('daily_reports', 'daily_report_manpower', 'daily_report_photos')
ORDER BY table_name;

SELECT typname
FROM pg_type
WHERE typname IN ('daily_report_status', 'daily_report_photo_category')
ORDER BY typname;
