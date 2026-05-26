-- Phase M2 (field app): clock-in / clock-out events.
--
-- One row per atomic punch. A "session" is a pair of consecutive
-- (in → out) events for the same employee. We deliberately do NOT
-- collapse pairs into a single "sessions" row because:
--
--   - Forgetting to clock out is the rule, not the exception. Pair-on-read
--     lets us flag dangling 'in' events as anomalies, and lets an admin
--     fix them by inserting a missing 'out' punch — no schema gymnastics.
--   - GPS coords are interesting both at the start AND end of a session.
--     Two atomic rows preserve both.
--   - Aggregating into weekly time_entries (the existing payroll table)
--     is a separate computation: read sessions for week, group by
--     (employee, date, project), sum hours, write/update time_entries.
--     M2 ships clock events only; the aggregation step is a follow-up.
--
-- project_id is nullable: not every clock-in is tied to a specific job.
-- A worker showing up to the yard / running errands clocks in with no
-- project; the office allocates the hours later.

CREATE TABLE IF NOT EXISTS clock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  cost_code_id uuid REFERENCES cost_codes(id) ON DELETE SET NULL,
  -- 'in' or 'out'. CHECK constraint guards against typos; we keep it as
  -- text (rather than an enum) so future kinds like 'break_start' /
  -- 'break_end' can be added without an enum-alter migration.
  kind text NOT NULL CHECK (kind IN ('in', 'out')),
  -- The wall-clock moment the punch happened, as reported by the device.
  -- The server stamps created_at separately so we can detect large clock
  -- skew or after-the-fact "fix-it" punches.
  occurred_at timestamptz NOT NULL,
  -- Optional GPS at punch time. Phones surface lat/lng with ~3-15m
  -- accuracy outdoors. accuracy_m is the radius the OS reports — useful
  -- for filtering out wildly-imprecise punches (e.g. >100m means the
  -- phone couldn't get a real fix).
  gps_lat numeric(9, 6),
  gps_lng numeric(9, 6),
  gps_accuracy_m numeric(8, 2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- "Latest event for this employee" is the hottest query — every load of
-- /field has to ask "are you currently clocked in?". A composite desc
-- index on (employee_id, occurred_at) makes that a single index seek.
CREATE INDEX IF NOT EXISTS clock_events_employee_occurred_idx
  ON clock_events (employee_id, occurred_at DESC);

-- Company-scoped queries (admin "show all today's punches") also need a
-- covering index. We keep this separate from the employee one because
-- those access patterns are unrelated and a composite would force the
-- query planner into a partial scan when filtering by company alone.
CREATE INDEX IF NOT EXISTS clock_events_company_occurred_idx
  ON clock_events (company_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS clock_events_project_idx
  ON clock_events (project_id);
