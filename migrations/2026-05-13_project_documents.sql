-- Phase 1: Project Documents — additive schema for project-level file management.
--
-- IMPORTANT: Run this against the production Supabase database BEFORE deploying
-- the code that references this table. Every statement is additive and uses
-- IF NOT EXISTS / duplicate-object guards so it can be re-run idempotently.
--
-- Operator run path:
--   1. Open Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the SELECTs at the bottom show one table and one enum.
--   4. Create the `project-documents` Storage bucket (Private). See
--      src/lib/storage/project-documents.ts for the path layout.
--   5. Then deploy the application code.
--
-- Tables introduced (all keyed by project_id + scoped by company_id):
--   - project_documents: one row per uploaded file. Binary lives in
--     Supabase Storage (`project-documents` bucket). Self-FK on
--     parent_document_id is reserved for Phase 3 versioning.

-- ===========================================================================
-- Enum
-- ===========================================================================

DO $$ BEGIN
  CREATE TYPE document_category AS ENUM (
    'proposal',
    'estimate',
    'invoice',
    'contract',
    'permit',
    'drawing',
    'photo',
    'daily_report',
    'submittal',
    'warranty',
    'closeout',
    'financial',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- project_documents
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.project_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- Display name (user-editable). Defaults to original_file_name on upload.
  file_name text NOT NULL,
  -- What the user's filesystem called it — never mutated after upload.
  original_file_name text NOT NULL,
  -- Bucket key inside the `project-documents` storage bucket.
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL DEFAULT 0,

  category document_category NOT NULL DEFAULT 'other',
  description text,
  visible_to_client boolean NOT NULL DEFAULT false,

  -- Versioning placeholders — wired in a later phase. Self-FK.
  parent_document_id uuid REFERENCES public.project_documents(id) ON DELETE SET NULL,
  version_number integer NOT NULL DEFAULT 1,
  is_current_version boolean NOT NULL DEFAULT true,

  sort_order integer NOT NULL DEFAULT 0,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS project_documents_company_idx
  ON public.project_documents(company_id);
CREATE INDEX IF NOT EXISTS project_documents_project_idx
  ON public.project_documents(project_id);
CREATE INDEX IF NOT EXISTS project_documents_project_category_idx
  ON public.project_documents(project_id, category);
CREATE INDEX IF NOT EXISTS project_documents_parent_idx
  ON public.project_documents(parent_document_id);

-- ===========================================================================
-- Verification queries
-- ===========================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'project_documents';

SELECT typname
FROM pg_type
WHERE typname = 'document_category';
