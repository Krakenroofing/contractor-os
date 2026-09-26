-- Olga's inventory list request: a Supplier per product. Set by hand here;
-- when blank, the list shows the vendor of the latest PO the product was
-- received on (or ordered on, if nothing has been received yet).
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS supplier_vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL;
