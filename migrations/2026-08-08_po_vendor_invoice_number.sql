-- Vendor invoice number on purchase orders.
--
-- When the supplier's invoice arrives for an issued PO, accounting records
-- its invoice number against the PO (editable in any status from the PO
-- detail page — the invoice shows up long after issue). Surfaces on the AP
-- aging report + CSV so open commitments can be tied to vendor paperwork.

ALTER TABLE public.purchase_orders
  ADD COLUMN vendor_invoice_number text;
