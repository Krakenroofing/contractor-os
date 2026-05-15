import { z } from 'zod';

export const vendorTypeValues = ['supplier', 'subcontractor'] as const;
export type VendorType = (typeof vendorTypeValues)[number];

export const TYPE_LABEL: Record<VendorType, string> = {
  supplier: 'Supplier',
  subcontractor: 'Subcontractor',
};

export const TYPE_TONE: Record<VendorType, 'slate' | 'green'> = {
  supplier: 'slate',
  subcontractor: 'green',
};

const optionalString = z.string().optional().or(z.literal(''));

// Cost-type values mirror src/modules/receipts/schema.ts. Source of truth is
// the jobCostType enum in DB — we validate against this string list at the
// app layer because the column is plain text.
export const vendorCostTypeValues = [
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

export const vendorFormSchema = z.object({
  name: z.string().min(1, 'Company name is required').max(200),
  vendorType: z.enum(vendorTypeValues).default('supplier'),
  primaryContactName: optionalString,
  email: z
    .string()
    .email('Invalid email')
    .optional()
    .or(z.literal('')),
  phone: optionalString,
  addressLine1: optionalString,
  city: optionalString,
  state: optionalString,
  postalCode: optionalString,
  defaultTerms: z.string().max(100).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
  // Vendor defaults — Phase 1. Receipt form reads these to prefill.
  defaultCostCodeId: nullableUuid,
  defaultCostType: z
    .enum(vendorCostTypeValues)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? null : v)),
  defaultAccountingAccountId: nullableUuid,
});

export type VendorFormParsed = z.output<typeof vendorFormSchema>;
