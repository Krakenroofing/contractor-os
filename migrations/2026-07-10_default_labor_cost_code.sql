-- Default labor cost code — so clock-posted HOURS land a cost code and post
-- to job-cost labor instead of falling to overhead (unpostedWage).
--
-- The field time-clock captures a project but usually no cost code, so posted
-- time_entries rows carry a null cost code and computeLaborPostingPlan skips
-- them (it needs BOTH project AND cost code). These two nullable defaults let
-- the post step fall back to a labor code when the punch has none:
--   project.default_labor_cost_code_id  — per-job override (precise)
--   company.default_labor_cost_code_id  — company-wide fallback (blanket fix)
-- Resolution order at post time: punch code → project default → company default.
--
-- Both nullable, defaulted null, ON DELETE SET NULL (mirrors the labor-account
-- columns). Additive → safe to run before the matching deploy.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS default_labor_cost_code_id uuid
    REFERENCES cost_codes(id) ON DELETE SET NULL;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS default_labor_cost_code_id uuid
    REFERENCES cost_codes(id) ON DELETE SET NULL;
