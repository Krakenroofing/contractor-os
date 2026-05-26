-- Inventory Phase 6.4: stock locations.
--
-- Adds a per-company physical-location dimension to the inventory ledger:
-- "Main Yard", "Truck 1", "Job Site — 1234 Bay St", etc. On-hand becomes
-- a 2D rollup: per (item × location).
--
-- The default location: a "Main Yard" row seeded per company. Existing
-- inventory_movements and po_receipts are backfilled to point at it, so
-- on-hand totals stay correct from day one (the SUM unions across all
-- locations regardless of which one any given row is tagged to).
--
-- Receipts get one location per RECEIPT (header-level). All movements
-- created for a receipt inherit the same location. Per-line locations
-- would let one shipment spread across multiple yards but that's overkill
-- for v1 — operators rarely receive against multiple yards in one truck.
--
-- Adjustments take a per-movement location (we already write one row per
-- adjustment, so this is free).

-- ---- inventory_locations -----------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_locations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            text NOT NULL,
  notes           text,
  -- Exactly one default per company. Backfilled to "Main Yard" below.
  -- Enforced by the partial unique index further down rather than a CHECK
  -- so the app can flip the default by toggling two rows in a txn.
  is_default      boolean NOT NULL DEFAULT false,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_locations_company_idx
  ON inventory_locations (company_id);

-- Name unique within a company (case-insensitive, ignoring archived rows).
CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_company_name_uniq
  ON inventory_locations (company_id, LOWER(name))
  WHERE archived_at IS NULL;

-- At most one default per company.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_company_default_uniq
  ON inventory_locations (company_id)
  WHERE is_default = true AND archived_at IS NULL;

-- ---- seed: one default "Main Yard" per existing company ----------------
INSERT INTO inventory_locations (company_id, name, is_default)
SELECT c.id, 'Main Yard', true
  FROM companies c
 WHERE NOT EXISTS (
   SELECT 1 FROM inventory_locations il WHERE il.company_id = c.id
 );

-- ---- inventory_movements.location_id -----------------------------------
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS location_id uuid
    REFERENCES inventory_locations(id) ON DELETE SET NULL;

-- Backfill: every existing movement gets the company's default location.
UPDATE inventory_movements m
   SET location_id = il.id
  FROM inventory_locations il
 WHERE il.company_id = m.company_id
   AND il.is_default = true
   AND il.archived_at IS NULL
   AND m.location_id IS NULL;

-- Composite index for per (company × item × location) on-hand sums.
-- Partial-filter on non-null location so the index stays small and the
-- query plan can use it for the common "per-location on-hand" case.
CREATE INDEX IF NOT EXISTS inventory_movements_company_item_location_idx
  ON inventory_movements (company_id, inventory_item_id, location_id)
  WHERE location_id IS NOT NULL;

-- ---- po_receipts.location_id -------------------------------------------
ALTER TABLE po_receipts
  ADD COLUMN IF NOT EXISTS location_id uuid
    REFERENCES inventory_locations(id) ON DELETE SET NULL;

-- Backfill: every existing receipt header inherits the default location
-- so future queries that filter receipts by location include legacy data.
UPDATE po_receipts pr
   SET location_id = il.id
  FROM purchase_orders po
  JOIN inventory_locations il
    ON il.company_id = po.company_id
   AND il.is_default = true
   AND il.archived_at IS NULL
 WHERE pr.purchase_order_id = po.id
   AND pr.location_id IS NULL;

CREATE INDEX IF NOT EXISTS po_receipts_location_idx
  ON po_receipts (location_id);
