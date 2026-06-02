-- =====================================================================
-- Clock-event timezone verification (READ ONLY — no writes, no repair)
-- Date: 2026-06-02
--
-- CONTEXT
--   Field workers reported a 7:30 AM punch showing as 11:30 AM. The 4-hour
--   gap is exactly the summer (EDT) offset between America/Nassau and UTC.
--
-- FINDING
--   The bug was DISPLAY-ONLY. clock_events.occurred_at is a
--   `timestamptz` written from the server's `new Date()` at punch time, so
--   it already holds the correct absolute instant (UTC). Nothing in the
--   stored data is wrong, therefore there is NOTHING TO REPAIR. The fix
--   was in the field-app rendering (it formatted the instant in the
--   server's UTC zone instead of America/Nassau).
--
--   DO NOT run an UPDATE to "shift" these timestamps. The stored values
--   are correct; rewriting them would corrupt good data and double-shift
--   every punch.
--
-- PURPOSE OF THIS SCRIPT
--   Let an admin confirm, with their own eyes, that each stored instant
--   renders to the wall-clock time the worker actually punched once it is
--   converted to America/Nassau. Postgres `AT TIME ZONE 'America/Nassau'`
--   applies the correct DST-aware offset per row.
--
-- USAGE
--   Run against the Supabase/Postgres DB. Adjust the date filter as needed.
-- =====================================================================

SELECT
  ce.id,
  ce.kind,
  e.first_name || ' ' || e.last_name              AS employee,
  ce.occurred_at                                  AS stored_utc,        -- raw timestamptz (UTC instant)
  ce.occurred_at AT TIME ZONE 'America/Nassau'    AS nassau_local,      -- what the worker actually saw
  to_char(
    ce.occurred_at AT TIME ZONE 'America/Nassau',
    'YYYY-MM-DD HH12:MI AM'
  )                                               AS nassau_readable,
  -- The display bug would have shown THIS (UTC rendered as if local):
  to_char(ce.occurred_at AT TIME ZONE 'UTC', 'HH12:MI AM') AS old_buggy_display,
  ce.reviewed_at IS NOT NULL                      AS reviewed,
  ce.posted_time_entry_id IS NOT NULL             AS posted_to_payroll
FROM clock_events ce
JOIN employees e ON e.id = ce.employee_id
-- "Today" in Nassau terms, not UTC, so evening punches are included.
WHERE (ce.occurred_at AT TIME ZONE 'America/Nassau')::date
      = (now() AT TIME ZONE 'America/Nassau')::date
ORDER BY e.last_name, e.first_name, ce.occurred_at;

-- Expected result: `nassau_readable` matches the punch times workers
-- report (e.g. 07:30 AM), while `old_buggy_display` shows the inflated
-- value they were complaining about (e.g. 11:30 AM). Stored data is fine.
