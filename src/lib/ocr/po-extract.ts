// PO extraction wrapper around the Document AI receipt/expense processor.
//
// Reuses the existing extractReceipt() pipeline (Phase 2.6) — vendor
// estimates and quotes return the same entity shapes (supplier_name,
// invoice_date, line_item with description/quantity/amount, subtotal,
// total_tax, total). For higher accuracy on vendor invoices specifically,
// a separate "Invoice Parser" processor could be plumbed here later; for
// now, one processor covers receipts and PO-style documents.
//
// The output schema is PO-shaped: header fields + an array of lines that
// match purchase_order_lines closely so the preview UI maps cleanly.

import 'server-only';
import {
  extractReceipt,
  isOcrConfigured,
  OcrNotConfiguredError,
} from './document-ai';

export { isOcrConfigured, OcrNotConfiguredError };

export type ExtractedPoLine = {
  description: string;
  quantity: number;
  unitCost: number;
  amount: number;
};

export type ExtractedPo = {
  vendorName: string | null;
  documentDate: string | null; // YYYY-MM-DD
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  currency: string | null;
  lines: ExtractedPoLine[];
};

export async function extractPurchaseOrderFromPdf(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<ExtractedPo> {
  const raw = await extractReceipt(input);

  const lines: ExtractedPoLine[] = (raw.lineItems ?? [])
    .map((li) => {
      const qty = Number.isFinite(li.quantity) ? Number(li.quantity ?? 0) : 0;
      const amount = Number.isFinite(li.amount) ? Number(li.amount ?? 0) : 0;
      // Unit cost is rarely surfaced directly. Derive it from amount / qty
      // when both are present, otherwise leave at 0 and let the user fill in.
      const unitCost = qty > 0 ? amount / qty : 0;
      return {
        description: (li.description ?? '').trim(),
        quantity: qty > 0 ? qty : 1,
        unitCost: Math.round(unitCost * 10000) / 10000,
        amount,
      };
    })
    .filter((l) => l.description !== '' || l.amount > 0);

  return {
    vendorName: raw.vendorName?.trim() || null,
    documentDate: raw.receiptDate ?? null,
    subtotal: raw.subtotal ?? null,
    taxAmount: raw.vatAmount ?? null,
    total: raw.total ?? null,
    currency: raw.currency ?? null,
    lines,
  };
}
