-- Phase M1 (field app foundation): link a logged-in user to a specific
-- employee record.
--
-- Why: the existing `users` and `employees` tables describe two different
-- populations.
--
--   users      = people who log into the app (owner / PM / accounting today)
--   employees  = people we pay through payroll (NIB, paystubs)
--
-- A field crew member is in `employees` (so we can pay them) but had no row
-- in `users` (so they couldn't log in). The field app needs both: the
-- person logs in via Supabase Auth (users), and once authenticated we need
-- to know which employee they ARE so we can:
--
--   - Pre-fill their name on daily reports + crew rosters
--   - Stamp clock-in/out events with the right employee_id
--   - Show their pay info on /field/profile
--   - Filter "today's assignments" by employee
--
-- Cardinality: one user ↔ at most one employee (UNIQUE constraint). A
-- payroll-only worker without app access stays as employees row with no
-- linked user. An office worker who isn't on payroll stays as users row
-- with employee_id = NULL. Both shapes remain valid.
--
-- ON DELETE SET NULL: if HR archives an employee, the login still works
-- (so they can sign in to finish paperwork) — it just becomes unlinked.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employee_id uuid
    REFERENCES employees(id) ON DELETE SET NULL;

-- Partial unique index: enforces 1:1 only on non-NULL values so multiple
-- users without an employee link are allowed (the common case for office
-- staff).
CREATE UNIQUE INDEX IF NOT EXISTS users_employee_id_uniq
  ON users (employee_id)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_employee_id_idx
  ON users (employee_id);

-- Same idea on invitations: when an owner invites a new field worker, they
-- pick the matching employee record on the invite form. That choice is
-- stamped here so when the recipient accepts (creating their users row),
-- the accept-invite action can copy employee_id over in the same
-- transaction. Without this column, the link would require a separate
-- admin step after the new user signs in.
--
-- ON DELETE SET NULL: if the employee is archived between invite + accept,
-- the invitation still works — it just becomes unlinked.
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS employee_id uuid
    REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invitations_employee_id_idx
  ON invitations (employee_id);
