-- Roadmap P8 — Team notes become the Requests page, with priority and a
-- working stage. open/done stays the resolution status (the scheduled
-- task runner reads it); stage tracks where an open request stands.
ALTER TABLE team_tasks
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'new';

ALTER TABLE team_tasks DROP CONSTRAINT IF EXISTS team_tasks_priority_chk;
ALTER TABLE team_tasks ADD CONSTRAINT team_tasks_priority_chk
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE team_tasks DROP CONSTRAINT IF EXISTS team_tasks_stage_chk;
ALTER TABLE team_tasks ADD CONSTRAINT team_tasks_stage_chk
  CHECK (stage IN ('new', 'in_progress', 'waiting'));
