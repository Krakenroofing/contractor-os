-- Phase M6.2: post reviewed clock sessions into time_entries.
--
-- Adds the idempotency link from a clock punch to the time_entries row
-- it landed in when posted. Both punches of a paired session carry the
-- SAME posted_time_entry_id — that's how we know the session is already
-- posted (and which time-entry row to update/delete if it changes).
--
-- ON DELETE SET NULL is intentional: if the office deletes the time
-- entry on /payroll, both punches automatically become "unposted" again
-- and can be re-posted (or edited then re-posted). This is the
-- correction workflow for "we posted the wrong hours" without needing a
-- separate unpost button.

ALTER TABLE clock_events
  ADD COLUMN IF NOT EXISTS posted_time_entry_id uuid
    REFERENCES time_entries(id) ON DELETE SET NULL;

-- "Reviewed and not yet posted" is the hot query when the Post-to-payroll
-- button computes its count and pulls the rows to insert. A partial
-- index on the small subset of postable rows keeps that cheap.
CREATE INDEX IF NOT EXISTS clock_events_postable_idx
  ON clock_events (company_id, reviewed_at)
  WHERE reviewed_at IS NOT NULL AND posted_time_entry_id IS NULL;
