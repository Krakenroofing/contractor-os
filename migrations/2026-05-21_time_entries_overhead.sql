-- Phase 4.8: support overhead labor + multi-project allocation.
--
-- Adds is_overhead so we can distinguish overhead work (admin,
-- training, equipment maintenance — the company eats the cost) from
-- truly unassigned rows that just haven't been allocated to a job yet.
-- When true, project_id stays null but the row carries a deliberate
-- "this is non-billable / company-side" marker.
--
-- Multi-project allocation doesn't need a schema change — when the
-- form posts multiple (project, cost_code, %) allocations, the action
-- splits the entry into N rows and proportions hours/amount across
-- each. From the database's perspective each split row is just a
-- regular time_entries row.

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS is_overhead boolean NOT NULL DEFAULT false;
