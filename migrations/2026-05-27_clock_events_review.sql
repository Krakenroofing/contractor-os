-- Phase M6.1: office-side clock-events review.
--
-- Adds a review flag to clock_events. The office (owner / PM / accounting)
-- marks a paired in→out session as reviewed before its hours are eligible
-- to post into time_entries (M6.2 wires that bridge).
--
-- The flag lives on each punch row rather than on a derived "session" row
-- because sessions are still pair-on-read — see the original 2026-05-26
-- migration. A session is considered reviewed when BOTH of its punches
-- carry reviewed_at. Editing a punch clears its flag, forcing re-review.

ALTER TABLE clock_events
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Reviewed-state filter shows up in the office grid ("show unreviewed
-- only") and in M6.2's post-to-payroll query ("reviewed AND not yet
-- posted"). A partial index keeps the hot path cheap without bloating
-- writes on the much-more-common unreviewed rows.
CREATE INDEX IF NOT EXISTS clock_events_reviewed_at_idx
  ON clock_events (company_id, reviewed_at)
  WHERE reviewed_at IS NOT NULL;
