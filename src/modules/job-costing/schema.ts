import { z } from 'zod';

export const jobCostTypeValues = [
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
export type JobCostType = (typeof jobCostTypeValues)[number];

export const JOB_COST_TYPE_LABEL: Record<JobCostType, string> = {
  labor: 'Labor',
  labor_burden: 'Labor Burden',
  materials: 'Materials',
  subcontractor: 'Subcontractor',
  equipment_rental: 'Equipment Rental',
  owned_equipment: 'Owned Equipment',
  freight: 'Freight',
  customs_duty: 'Customs Duty',
  vat: 'VAT',
  tools_consumables: 'Tools / Consumables',
  fuel_travel: 'Fuel / Travel',
  per_diem_housing: 'Per Diem / Housing',
  permits_fees: 'Permits / Fees',
  disposal: 'Disposal',
  general_conditions: 'General Conditions',
  change_order_work: 'Change Order Work',
  other: 'Other',
};

// Tone hint for badges on the entries list.
export const JOB_COST_TYPE_TONE: Record<
  JobCostType,
  'amber' | 'blue' | 'slate' | 'green' | 'purple' | 'red'
> = {
  labor: 'amber',
  labor_burden: 'amber',
  materials: 'blue',
  subcontractor: 'green',
  equipment_rental: 'slate',
  owned_equipment: 'slate',
  freight: 'purple',
  customs_duty: 'red',
  vat: 'red',
  tools_consumables: 'slate',
  fuel_travel: 'slate',
  per_diem_housing: 'slate',
  permits_fees: 'slate',
  disposal: 'slate',
  general_conditions: 'slate',
  change_order_work: 'amber',
  other: 'slate',
};

const moneyString = z
  .string()
  .trim()
  .min(1, 'Required')
  .regex(/^-?\d+(\.\d{1,4})?$/, 'Enter a number');

// Form schema. The action layer converts these to numeric strings for
// drizzle's `numeric()` column inputs.
export const costEntryFormSchema = z.object({
  entryDate: z
    .string()
    .min(1, 'Date is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  costCodeId: z.string().uuid('Pick a cost code'),
  costType: z.enum(jobCostTypeValues).default('other'),
  vendorId: z.string().uuid().optional().or(z.literal('')),
  description: z.string().trim().min(1, 'Description is required').max(500),
  quantity: moneyString.default('1'),
  unitCost: moneyString.default('0'),
  // amount is computed server-side as quantity × unitCost — but we accept an
  // override field so users can paste a total directly.
  amount: moneyString.optional(),
  isBillable: z.coerce.boolean().default(false),
  markupPercent: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, 'Percentage')
    .optional()
    .or(z.literal('')),
  notes: z.string().trim().max(2000).optional().default(''),
});

export type CostEntryFormInput = z.infer<typeof costEntryFormSchema>;

// ===========================================================================
// Phase 2 — specialized form schemas
// ===========================================================================

// Labor entry: hours × rate, with optional burden %. Workers count is metadata
// surfaced in the description; the math lives in (hours, rate, burden).
export const laborEntryFormSchema = z.object({
  entryDate: z
    .string()
    .min(1, 'Date is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  costCodeId: z.string().uuid('Pick a cost code'),
  crewCompany: z.string().trim().max(200).optional().default(''),
  workerName: z.string().trim().min(1, 'Worker / crew name is required').max(200),
  trade: z.string().trim().max(200).optional().default(''),
  workerCount: z.coerce.number().int().min(1).max(9999).default(1),
  hours: moneyString.default('0'),
  hourlyRate: moneyString.default('0'),
  burdenPercent: z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d{1,3})?$/, 'Burden % must be a number')
    .optional()
    .or(z.literal('')),
  notes: z.string().trim().max(2000).optional().default(''),
});

export type LaborEntryFormInput = z.infer<typeof laborEntryFormSchema>;

export const equipmentRateBasisValues = ['day', 'week', 'month', 'unit'] as const;
export type EquipmentRateBasis = (typeof equipmentRateBasisValues)[number];

export const EQUIPMENT_RATE_BASIS_LABEL: Record<EquipmentRateBasis, string> = {
  day: 'Per day',
  week: 'Per week',
  month: 'Per month',
  unit: 'Per unit / use',
};

// Equipment entry: owned vs rented switches the cost_type. Rental rate basis
// goes into the description text so reports stay readable.
export const equipmentEntryFormSchema = z.object({
  entryDate: z
    .string()
    .min(1, 'Date is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  costCodeId: z.string().uuid('Pick a cost code'),
  ownership: z.enum(['owned', 'rented']).default('rented'),
  equipmentName: z
    .string()
    .trim()
    .min(1, 'Equipment name is required')
    .max(200),
  vendorId: z.string().uuid().optional().or(z.literal('')),
  rateBasis: z.enum(equipmentRateBasisValues).default('day'),
  rate: moneyString.default('0'),
  units: moneyString.default('1'),
  notes: z.string().trim().max(2000).optional().default(''),
});

export type EquipmentEntryFormInput = z.infer<typeof equipmentEntryFormSchema>;

// Vendor expense: one form posts up to 4 ledger rows
// (subtotal + VAT% + freight + duty), all sharing the same vendor and
// vendor_invoice_number. Optional fields are skipped if blank.
export const vendorExpenseFormSchema = z.object({
  entryDate: z
    .string()
    .min(1, 'Invoice date is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  vendorId: z.string().uuid('Vendor is required'),
  invoiceNumber: z.string().trim().min(1, 'Invoice number is required').max(120),
  costCodeId: z.string().uuid('Pick a cost code for the main line'),
  subtotalCostType: z.enum(jobCostTypeValues).default('materials'),
  description: z.string().trim().min(1, 'Description is required').max(500),
  subtotal: moneyString.default('0'),
  vatPercent: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, 'VAT % must be a number')
    .optional()
    .or(z.literal('')),
  freightAmount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Freight must be a number')
    .optional()
    .or(z.literal('')),
  dutyAmount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Duty must be a number')
    .optional()
    .or(z.literal('')),
  notes: z.string().trim().max(2000).optional().default(''),
});

export type VendorExpenseFormInput = z.infer<typeof vendorExpenseFormSchema>;

// Cost-to-complete forecast per cost code.
export const forecastFormSchema = z.object({
  costCodeId: z.string().uuid('Pick a cost code'),
  costToComplete: moneyString.default('0'),
  notes: z.string().trim().max(2000).optional().default(''),
  riskFlag: z.coerce.boolean().default(false),
});

export type ForecastFormInput = z.infer<typeof forecastFormSchema>;
