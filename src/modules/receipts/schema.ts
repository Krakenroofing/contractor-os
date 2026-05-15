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

export const receiptStatusValues = ['draft', 'posted', 'void'] as const;
export const RECEIPT_STATUS_LABEL: Record<
  (typeof receiptStatusValues)[number],
  string
> = {
  draft: 'Draft',
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
  .transform((v) => (v === '' || v === undefined ? null : v))
  .refine(
    (v) =>
      v === null ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    { message: 'Invalid id' },
  );

const moneyString = z
  .string()
  .trim()
  .default('0')
  .transform((v) => {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  });

const percentString = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .transform((v) => {
    if (v === '' || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

export const upsertReceiptSchema = z.object({
  id: z.string().uuid().optional(),
  receiptDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  vendorId: nullableUuid,
  projectId: nullableUuid,
  costCodeId: nullableUuid,
  accountingAccountId: nullableUuid,
  bankAccountId: nullableUuid,
  paymentSourceType: z.enum(paymentSourceValues).default('cash'),
  currency: z.string().trim().min(3).max(3).toUpperCase(),
  subtotal: moneyString,
  vatAmount: moneyString,
  total: moneyString,
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
  costType: z
    .enum(costTypeValues)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? null : v)),
  isBillable: z.coerce.boolean().optional().default(false),
  isReimbursable: z.coerce.boolean().optional().default(false),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .default('')
    .transform((v) => (v === '' ? null : v)),
});
export type UpsertReceiptInput = z.infer<typeof upsertReceiptSchema>;
