-- PO lines can belong to a different job than the PO header (2026-09-16).
-- One order of 100 rolls split 50/50 across two jobs stays ONE purchase
-- order: each line may carry its own project_id; NULL = the PO's project.
-- Committed cost and the cost-code breakdown attribute lines to
-- line-project-or-header, and bills created from a PO carry the line's
-- job onto the receipt line.
alter table purchase_order_lines
  add column if not exists project_id uuid references projects(id) on delete set null;

create index if not exists purchase_order_lines_project_idx
  on purchase_order_lines(project_id) where project_id is not null;
