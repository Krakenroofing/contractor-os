import { z } from 'zod';

export const paymentSourceValues = [
  'bank',
  'credit_card',
  'cash',
  'other',
] as const;
export const PAYMENT_SOURCE_LABEL: Record<
  (typeof paymentSourceValues)[number],
  string
> = {
  bank: 'Bank',
  credit_card: 'Credit card',
  cash: 'Cash',
  other: 'Other',
};

export const receiptStatusValues = [
  'draft',
  'submitted',
  'posted',
  'void',
] as const;
export const RECEIPT_STATUS_LABEL: Record<
  (typeof receiptStatusValues)[number],
  string
> = {
  draft: 'Draft',
  submitted: 'Submitted',
  posted: 'Posted',
  void: 'Void',
};

// Mirrors jobCostTypeEnum in @/db/schema. Source of truth lives in DB; this
// list is what we expose on the receipt form's cost-type dropdown.
export const costTypeValues = [
  'labor',
  'labor_burden',
  'materials',
  'subcontractor',
  'equipment_rental',
  'owned_equipment',
  'freight',
  'customs_duty',
  'vat',
  'tools_consumables',
  'fuel_travel',
  'per_diem_housing',
  'permits_fees',
  'disposal',
  'general_conditions',
  'change_order_work',
  'other',
] as const;
export const COST_TYPE_LABEL: Record<(typeof costTypeValues)[number], string> = {
  labor: 'Labor',
  labor_burden: 'Labor burden',
  materials: 'Materials',
  subcontractor: 'Subcontractor',
  equipment_rental: 'Equipment rental',
  owned_equipment: 'Owned equipment',
  freight: 'Freight',
  customs_duty: 'Customs duty',
  vat: 'VAT',
  tools_consumables: 'Tools / consumables',
  fuel_travel: 'Fuel / travel',
  per_diem_housing: 'Per diem / housing',
  permits_fees: 'Permits / fees',
  disposal: 'Disposal',
  general_conditions: 'General conditions',
  change_order_work: 'Change order work',
  other: 'Other',
};

const nullableUuid = z
  .string()
  .optional()
  .or(z.literal(''))
  .or(z.null())
  .transform((v) => (v === '' || v === undefined || v === null ? null : v))
  .refine(
    (v) =>
      v === null ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    { message: 'Invalid id' },
  );

const moneyString = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  });

const percentString = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const trimmed = v.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  });

// Per-line input (Phase 2.1 multi-line). Lines are submitted as a JSON-encoded
// array in the `lines` field of the form post — see receipt-form.tsx.
export const upsertReceiptLineSchema = z.object({
  // Existing line id; absent for newly-added lines.
  id: z.string().uuid().optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
  projectId: nullableUuid,
  costCodeId: nullableUuid,
  accountingAccountId: nullableUuid,
  costType: z
    .enum(costTypeValues)
    .optional()
    .or(z.literal(''))
    .or(z.null())
    .transform((v) => (v === '' || v === undefined || v === null ? null : v)),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.null())
    .transform((v) => (v === '' || v === undefined || v === null ? null : v)),
  subtotal: moneyString,
  vatAmount: moneyString,
  total: moneyString,
  vatRatePercent: percentString,
  isBillable: z.coerce.boolean().optional().default(false),
  isReimbursable: z.coerce.boolean().optional().default(false),
  // Phase 2.4: who paid out of pocket. Required by submit/post when
  // is_reimbursable=true; the action validates that separately so drafts
  // can be saved with this still null.
  paidByUserId: nullableUuid,
});
export type UpsertReceiptLineInput = z.infer<typeof upsertReceiptLineSchema>;

export const upsertReceiptSchema = z.object({
  id: z.string().uuid().optional(),
  receiptDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  vendorId: nullableUuid,
  bankAccountId: nullableUuid,
  paymentSourceType: z.enum(paymentSourceValues).default('cash'),
  currency: z.string().trim().min(3).max(3).toUpperCase(),
  // Header VAT settings — apply as defaults to lines and drive VAT-included
  // semantics across the receipt.
  vatRatePercent: percentString,
  vatIncluded: z.coerce.boolean().optional().default(true),
  vatRecoverable: z.coerce.boolean().optional().default(true),
  vendorTin: z
    .string()
    .trim()
    .max(40)
    .optional()
    .default('')
    .transform((v) => (v === '' ? null : v)),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .default('')
    .transform((v) => (v === '' ? null : v)),
  // 1..N lines. Empty array is allowed only for brand-new drafts; Post will
  // refuse a receipt with zero lines.
  lines: z.array(upsertReceiptLineSchema).max(50),
});
export type UpsertReceiptInput = z.infer<typeof upsertReceiptSchema>;
