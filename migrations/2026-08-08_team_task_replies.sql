-- Threaded replies on Team Notes & Tasks (Olga's ask): a note often needs a
-- follow-up answer or discussion, not just open/done. One row per reply,
-- newest-last under its task. Name snapshot mirrors team_tasks.created_by_name
-- so threads read correctly if a user is later removed.

CREATE TABLE public.team_task_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.team_tasks(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX team_task_replies_task_idx ON public.team_task_replies(task_id);
CREATE INDEX team_task_replies_company_idx ON public.team_task_replies(company_id);

-- Deny-all RLS (house pattern): app connects as table owner; blocks the
-- anon-key/PostgREST path.
ALTER TABLE public.team_task_replies ENABLE ROW LEVEL SECURITY;
