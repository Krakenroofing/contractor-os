-- Daily reports: one report per (project, date, CREATOR) instead of one per
-- (project, date). The old rule locked a jobsite's day to whoever filed first
-- — the rest of the crew got funneled into that person's report. Now each
-- employee files their own daily report for the same job/day, and everyone can
-- upload their own photos and notes.
--
-- Voided / soft-deleted rows stay excluded so a worker can void a mistake and
-- re-file for the same day.

DROP INDEX IF EXISTS daily_reports_project_date_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS daily_reports_project_date_creator_uniq
  ON public.daily_reports(project_id, report_date, created_by)
  WHERE deleted_at IS NULL AND status <> 'void';
