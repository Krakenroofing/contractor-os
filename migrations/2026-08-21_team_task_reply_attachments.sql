-- Reply-with-picture on Team Notes & Tasks (Chris, 2026-08-21): an
-- attachment can now belong to a specific REPLY under a note. Task-level
-- attachments keep reply_id NULL.
ALTER TABLE public.team_task_attachments
  ADD COLUMN reply_id uuid REFERENCES public.team_task_replies(id) ON DELETE CASCADE;
CREATE INDEX team_task_attachments_reply_idx ON public.team_task_attachments(reply_id);
