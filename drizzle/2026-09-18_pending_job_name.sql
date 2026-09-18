-- Field crew can punch onto a job that doesn't exist in the system yet by
-- naming it ("Mrs. Johnson roof"). The name rides the punch and the posted
-- time entry until the office creates/links the real project, which
-- back-fills project_id everywhere the name appears.
ALTER TABLE clock_events ADD COLUMN pending_job_name text;
ALTER TABLE time_entries ADD COLUMN pending_job_name text;
