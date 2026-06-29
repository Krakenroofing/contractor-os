-- Team Notes & Tasks — a per-company shared inbox any team member can post a
-- note or task into for the owner/admins to address (with file attachments).
--
-- IMPORTANT: Run this against the production Supabase database BEFORE deploying
-- the code that references these tables. Every statement is additive and uses
-- IF NOT EXISTS / duplicate-object guards so it can be re-run idempotently.
--
-- Operator run path:
--   1. Open Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the SELECTs at the bottom show two tables, one enum, one bucket.
--   4. Then deploy the application code.
--
-- The `team-task-attachments` Storage bucket is created here (private) so no
-- manual dashboard step is needed. See
-- src/lib/storage/team-task-attachments.ts for the path layout.

-- ===========================================================================
-- Enum
-- ===========================================================================

DO $$ BEGIN
  CREATE TYPE team_task_status AS ENUM ('open', 'done');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- team_tasks
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.team_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name text NOT NULL DEFAULT '',

  body text NOT NULL DEFAULT '',
  status team_task_status NOT NULL DEFAULT 'open',

  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_by_name text,
  resolved_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS team_tasks_company_idx
  ON public.team_tasks(company_id);
CREATE INDEX IF NOT EXISTS team_tasks_company_status_idx
  ON public.team_tasks(company_id, status);

-- ===========================================================================
-- team_task_attachments
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.team_task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.team_tasks(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  file_name text NOT NULL,
  original_file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_task_attachments_task_idx
  ON public.team_task_attachments(task_id);
CREATE INDEX IF NOT EXISTS team_task_attachments_company_idx
  ON public.team_task_attachments(company_id);

-- ===========================================================================
-- Storage bucket (private). Idempotent — does nothing if it already exists.
-- ===========================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('team-task-attachments', 'team-task-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- Verification queries
-- ===========================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('team_tasks', 'team_task_attachments');

SELECT typname FROM pg_type WHERE typname = 'team_task_status';

SELECT id FROM storage.buckets WHERE id = 'team-task-attachments';
