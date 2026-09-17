-- Bill lines keep their quantity (2026-09-17): bills created from a PO
-- store quantity billed + unit cost per line so partial billing tracks by
-- qty and stays editable on the bill (net = qty × unit cost). Nullable —
-- hand-entered receipt lines without quantities are unchanged.
alter table receipt_lines
  add column if not exists quantity numeric(14,4);
alter table receipt_lines
  add column if not exists unit_cost numeric(14,4);
