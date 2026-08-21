-- "Add Bill" (Chris, 2026-08-21, QB parity): bills entered before any money
-- moves need a due date. Stored on receipts (bills ARE receipts).
ALTER TABLE public.receipts ADD COLUMN due_date date;
