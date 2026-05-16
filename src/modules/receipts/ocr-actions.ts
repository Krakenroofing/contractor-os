'use server';

// Phase 2.6 OCR auto-fill — server actions. Two-step flow:
//   1. extractFromAttachmentAction → reads the file, calls Document AI,
//      returns the parsed JSON. NO database writes.
//   2. applyExtractedToReceiptAction → operator confirmed, write the
//      extracted values to the receipt header + line(s).
//
// Two steps so the operator gets to review what OCR found before it
// overwrites a draft. Posted / submitted receipts are immutable here
// (same gating as the regular upsert flow).

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { toMoneyString, toPercentString } from '@/lib/money';
import {
  createReceiptLine,
  getReceipt,
  listReceiptAttachments,
  listReceiptLines,
  recalcReceiptHeaderTotals,
  softDeleteReceiptLine,
  updateReceipt,
  updateReceiptLine,
} from '@/lib/data/receipts';
import { listVendors } from '@/lib/data/vendors';
import { downloadReceiptBlob } from '@/lib/storage/receipt-files';
import {
  extractReceipt,
  isOcrConfigured,
  OcrNotConfiguredError,
  type OcrExtractResult,
} from '@/lib/ocr/document-ai';
import { vatQuarterForDate } from './lib/vat';

const uuid = z.string().uuid();

export type OcrSuggestion = OcrExtractResult & {
  /** Best fuzzy-match against an existing vendor in the company. Operator
   *  can still pick a different vendor on apply. */
  vendorMatchId?: string;
};

export type ExtractActionResult =
  | { ok: true; suggestion: OcrSuggestion }
  | { ok: false; error: string };

export async function extractFromAttachmentAction(input: {
  receiptId: string;
  attachmentId: string;
}): Promise<ExtractActionResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) {
    return { ok: false, error: 'No permission.' };
  }
  if (!isOcrConfigured()) {
    return {
      ok: false,
      error:
        'OCR is not configured for this deployment. Ask an admin to set the GOOGLE_DOCUMENT_AI_* env vars.',
    };
  }
  const rid = uuid.safeParse(input.receiptId);
  const aid = uuid.safeParse(input.attachmentId);
  if (!rid.success || !aid.success) {
    return { ok: false, error: 'Invalid id.' };
  }
  const company = await getActiveCompany();
  const receipt = await getReceipt(company.id, rid.data);
  if (!receipt) return { ok: false, error: 'Receipt not found.' };
  if (receipt.status !== 'draft') {
    return { ok: false, error: 'OCR only runs on draft receipts.' };
  }
  const attachments = await listReceiptAttachments(company.id, rid.data);
  const target = attachments.find((a) => a.id === aid.data);
  if (!target) return { ok: false, error: 'Attachment not found.' };

  try {
    const blob = await downloadReceiptBlob(target.storagePath);
    if (!blob) return { ok: false, error: 'Could not read the attachment.' };
    const extracted = await extractReceipt({
      bytes: blob.bytes,
      mimeType: target.mimeType,
    });

    // Best-effort vendor fuzzy match — case-insensitive prefix or token match
    // against vendor.name. Returns the first vendor whose lowercased name
    // is contained in or contains the extracted vendor name.
    let vendorMatchId: string | undefined;
    if (extracted.vendorName) {
      const vendors = await listVendors(company.id);
      const needle = extracted.vendorName.toLowerCase().trim();
      const hit =
        vendors.find((v) => v.name.toLowerCase() === needle) ??
        vendors.find((v) => v.name.toLowerCase().includes(needle)) ??
        vendors.find((v) => needle.includes(v.name.toLowerCase()));
      vendorMatchId = hit?.id;
    }

    return {
      ok: true,
      suggestion: { ...extracted, vendorMatchId },
    };
  } catch (err) {
    if (err instanceof OcrNotConfiguredError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'OCR call failed.',
    };
  }
}

// ---- Apply ----

const applySchema = z.object({
  receiptId: z.string().uuid(),
  // Operator-edited values from the preview UI. Any field absent = don't
  // touch the existing value.
  vendorId: z.string().uuid().nullable().optional(),
  receiptDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  currency: z.string().trim().min(3).max(3).toUpperCase().optional(),
  // Line items as parsed. Empty array = don't replace lines (keep what's
  // there). Non-empty = replace the existing lines with these (each one
  // becomes a fresh draft line for the operator to fill out the
  // project / cost code on).
  lineItems: z
    .array(
      z.object({
        description: z.string().trim().max(500).optional(),
        amount: z.number().optional(),
      }),
    )
    .max(50)
    .optional(),
  // Optional totals — if no per-line breakdown, fall back to a single line
  // with the receipt's gross total.
  total: z.number().optional(),
  vatAmount: z.number().optional(),
  vatRate: z.number().optional(),
});

export async function applyExtractedToReceiptAction(
  input: z.input<typeof applySchema>,
): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) {
    return { ok: false, error: 'No permission.' };
  }
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const d = parsed.data;
  const company = await getActiveCompany();
  const receipt = await getReceipt(company.id, d.receiptId);
  if (!receipt) return { ok: false, error: 'Receipt not found.' };
  if (receipt.status !== 'draft') {
    return { ok: false, error: 'OCR apply only runs on draft receipts.' };
  }

  const headerPatch: Parameters<typeof updateReceipt>[2] = {};
  if (d.vendorId !== undefined) headerPatch.vendorId = d.vendorId;
  if (d.receiptDate) {
    headerPatch.receiptDate = d.receiptDate;
    if (company.isVatActive) {
      headerPatch.vatPeriodQuarter = vatQuarterForDate(d.receiptDate);
    }
  }
  if (d.currency) headerPatch.currency = d.currency;
  if (d.vatRate !== undefined && Number.isFinite(d.vatRate)) {
    headerPatch.vatRatePercent = toPercentString(d.vatRate);
  }
  if (Object.keys(headerPatch).length > 0) {
    await updateReceipt(company.id, receipt.id, headerPatch);
  }

  // Decide line strategy.
  // - If lineItems has rows: replace the receipt's lines with one new line
  //   per item. Soft-delete the old lines.
  // - Else if total provided: ensure exactly one line and set its gross to
  //   the OCR total. Subtotal / VAT split derived if a rate is provided.
  // - Else: do nothing to lines.

  const existing = await listReceiptLines(company.id, receipt.id);
  const round = (n: number) => Math.round(n * 100) / 100;

  if (d.lineItems && d.lineItems.length > 0) {
    // Soft-delete current lines first (preserving any that are already
    // reimbursed — same rule as the form upsert).
    for (const l of existing) {
      if (l.reimbursementPayoutId) continue;
      await softDeleteReceiptLine(company.id, l.id);
    }
    let sort = 0;
    for (const item of d.lineItems) {
      const gross = item.amount ?? 0;
      const rate = d.vatRate ?? 0;
      const denom = 1 + rate / 100;
      const sub = rate > 0 ? round(gross / denom) : gross;
      const vat = round(gross - sub);
      await createReceiptLine({
        companyId: company.id,
        receiptId: receipt.id,
        sortOrder: sort++,
        description: item.description ?? null,
        subtotal: toMoneyString(sub),
        vatAmount: toMoneyString(vat),
        total: toMoneyString(gross),
        vatRatePercent: rate > 0 ? toPercentString(rate) : null,
        isBillable: false,
        isReimbursable: false,
      });
    }
  } else if (d.total !== undefined && d.total > 0) {
    const rate = d.vatRate ?? 0;
    const denom = 1 + rate / 100;
    const sub = rate > 0 ? round(d.total / denom) : d.total;
    const vat = round(d.total - sub);
    const linePatch = {
      subtotal: toMoneyString(sub),
      vatAmount: toMoneyString(vat),
      total: toMoneyString(d.total),
      vatRatePercent: rate > 0 ? toPercentString(rate) : null,
    } as const;
    if (existing.length === 0) {
      await createReceiptLine({
        companyId: company.id,
        receiptId: receipt.id,
        sortOrder: 0,
        ...linePatch,
        isBillable: false,
        isReimbursable: false,
      });
    } else {
      // Update the first line only; leave additional lines alone.
      const first = existing[0];
      if (!first.reimbursementPayoutId) {
        await updateReceiptLine(company.id, first.id, linePatch);
      }
    }
  }

  await recalcReceiptHeaderTotals(company.id, receipt.id);
  revalidatePath(`/banking/receipts/${receipt.id}`);
  return { ok: true };
}

/** Lightweight readiness probe so the UI knows whether to render the
 *  "Auto-fill" button at all. */
export async function ocrIsEnabledAction(): Promise<boolean> {
  // Permission check guards against the (unlikely) case of a viewer probing
  // configuration — still no info leak since we only return a boolean.
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) return false;
  await getActiveCompanyId();
  return isOcrConfigured();
}
