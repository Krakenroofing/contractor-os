-- Edit-in-place for team notes and their replies. edited_at is the
-- "(edited)" marker — null until the first edit.

ALTER TABLE public.team_tasks ADD COLUMN edited_at timestamptz;
ALTER TABLE public.team_task_replies ADD COLUMN edited_at timestamptz;
