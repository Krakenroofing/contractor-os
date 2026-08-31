-- Historical labor allocations (pre-time-tracking periods, imported from
-- QuickBooks) get their own job-cost source so "Post labor to job costs"
-- reposts never clobber them. Run in the Supabase SQL editor BEFORE
-- deploying the application code.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block —
-- run this statement on its own.

ALTER TYPE job_cost_source ADD VALUE IF NOT EXISTS 'labor_manual';

-- Verification
SELECT unnest(enum_range(NULL::job_cost_source));
