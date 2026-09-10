-- Service / leak calls in the field clock (2026-09-10).
--
-- Crew on a service call often has no job to pick yet (the service
-- project is created when the office posts the work order), so they were
-- punching Overhead — hiding real jobsite hours. New flow:
--   1. Punch-in picker offers "Service / leak call" → is_service_call
--      on the punch, carried onto the posted time entry.
--   2. Posting a work order links the matching service-call/unassigned
--      time entries (same employee + work date) via work_order_id.
--   3. Payroll labor posting keeps excluding these hours (no project) —
--      the work-order lane carries the job cost, so no double count.
alter table clock_events
  add column if not exists is_service_call boolean not null default false;

alter table time_entries
  add column if not exists is_service_call boolean not null default false;
alter table time_entries
  add column if not exists work_order_id uuid references work_orders(id) on delete set null;

create index if not exists time_entries_work_order_idx
  on time_entries(work_order_id) where work_order_id is not null;
