-- Bills from Purchase Orders (Chris, 2026-08-21): a vendor bill (receipt)
-- can be created straight from a PO, selecting only the lines (and partial
-- quantities) that actually shipped. The bill carries the VENDOR'S invoice
-- number and stays an outstanding bill until matched to the bank payment.

ALTER TABLE public.receipts
  ADD COLUMN vendor_invoice_number text,
  ADD COLUMN purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL;

ALTER TABLE public.receipt_lines
  ADD COLUMN purchase_order_line_id uuid REFERENCES public.purchase_order_lines(id) ON DELETE SET NULL;

CREATE INDEX receipts_po_idx ON public.receipts(purchase_order_id);
CREATE INDEX receipt_lines_po_line_idx ON public.receipt_lines(purchase_order_line_id);
