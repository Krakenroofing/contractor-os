-- Add a per-cost-code default cost. Used as a price fallback on PO lines
-- when the picked inventory item has no defaultCost (or no inventory item
-- is linked, e.g. one-off rentals / labor / services).
--
-- Nullable on purpose: most cost codes don't carry a price (labor by hour
-- varies by worker, equipment rental varies by vendor) — only fill it in
-- when there's a sensible standing rate.
--
-- Inheritance chain on the PO line:
--   inventory_item.default_cost > 0  →  use it
--   else cost_code.default_cost > 0  →  use it
--   else 0                            →  user enters manually

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS default_cost numeric(14, 2);
