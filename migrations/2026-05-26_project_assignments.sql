-- Phase M3 (field app): per-day crew assignments.
--
-- One row says "employee X is working on project Y on date D". Admins
-- create these on the project detail page; the field app reads them on
-- /field/jobs to power the "what jobs am I on today" list.
--
-- Why per-day rows instead of a date range:
--
--   - Roofing crews shuffle constantly — Joe might be on the Carlos job
--     Monday/Tuesday, then jump to a different project Wednesday, then
--     back. Modeling that as ranges means lots of split/merge bookkeeping.
--     Per-day rows are dumb-simple to add/remove.
--   - Querying "who's on this project today" or "what jobs does Joe
--     have today" is a single equality lookup on (date, ...).
--   - Reports that want "Joe's week" group rows by date — trivial.
--
-- Hard-limit cardinality with a unique constraint so a careless admin
-- click doesn't create duplicate assignments for the same (employee,
-- project, date). The same employee CAN be on multiple projects on the
-- same day (split day) — that's a distinct (project_id, employee_id,
-- date) tuple.

CREATE TABLE IF NOT EXISTS project_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assigned_date date NOT NULL,
  -- Free-text role for this assignment (foreman / labourer / helper /
  -- sub crew). Optional — the employee's general employment type
  -- already covers most cases; this overrides per-day when the role
  -- shifts (e.g. a labourer running point as foreman that day).
  role_label text,
  notes text,
  -- Who scheduled this assignment, for audit + so we can show "added
  -- by Chris" next to each row. Nullable so a deleted user doesn't
  -- cascade-delete history.
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Anti-duplicate guard. Per the comment above: same employee on a
-- different project the same day is allowed; same employee on the same
-- project the same day twice is not.
CREATE UNIQUE INDEX IF NOT EXISTS project_assignments_uniq
  ON project_assignments (project_id, employee_id, assigned_date);

-- "What's Joe doing today" is the field app's hottest read. (employee,
-- date) gets us there in one index seek.
CREATE INDEX IF NOT EXISTS project_assignments_employee_date_idx
  ON project_assignments (employee_id, assigned_date);

-- "Who's on this project this week" — admin view on /projects/[id].
CREATE INDEX IF NOT EXISTS project_assignments_project_date_idx
  ON project_assignments (project_id, assigned_date);

CREATE INDEX IF NOT EXISTS project_assignments_company_date_idx
  ON project_assignments (company_id, assigned_date);
