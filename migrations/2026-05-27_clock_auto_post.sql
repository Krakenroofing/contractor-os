-- Phase M6.3: opt-in auto-post on clock-out.
--
-- When this flag is ON for a company, the punch-out action immediately
-- marks the session reviewed (by the worker themselves) and posts it
-- to time_entries — no admin ceremony in the middle. OFF by default
-- because most shops want a daily review pass before hours flow to
-- payroll; flip on once you trust the punch data.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS auto_post_clock_sessions boolean NOT NULL DEFAULT false;
