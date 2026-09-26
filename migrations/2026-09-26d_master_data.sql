-- Roadmap P4 — master data + duplicate checks.

-- The vendor's own item number (ABC, Gulfeagle, QXO …) for one catalog item.
-- One item can carry a number per vendor; a vendor number points at exactly
-- one item.
CREATE TABLE IF NOT EXISTS vendor_item_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  vendor_item_number text NOT NULL CHECK (btrim(vendor_item_number) <> ''),
  vendor_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_item_numbers_vendor_number_uniq
  ON vendor_item_numbers (company_id, vendor_id, lower(btrim(vendor_item_number)));
CREATE INDEX IF NOT EXISTS vendor_item_numbers_item_idx
  ON vendor_item_numbers (inventory_item_id);

-- Default cost code per inventory category (an item's own default wins).
CREATE TABLE IF NOT EXISTS inventory_category_cost_codes (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category text NOT NULL,
  cost_code_id uuid NOT NULL REFERENCES cost_codes(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, category)
);

-- Duplicate-invoice lookups across companies key on the normalized number.
CREATE INDEX IF NOT EXISTS receipts_vendor_invoice_norm_idx
  ON receipts (lower(regexp_replace(vendor_invoice_number, '[^A-Za-z0-9]', '', 'g')))
  WHERE vendor_invoice_number IS NOT NULL AND deleted_at IS NULL;
