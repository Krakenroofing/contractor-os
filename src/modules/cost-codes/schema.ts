import { z } from 'zod';

export const costCodeCategoryValues = [
  'labor',
  'material',
  'equipment',
  'subcontract',
  'other',
] as const;

export type CostCodeCategory = (typeof costCodeCategoryValues)[number];

export const CATEGORY_LABEL: Record<CostCodeCategory, string> = {
  labor: 'Labor',
  material: 'Material',
  equipment: 'Equipment',
  subcontract: 'Subcontract',
  other: 'Other',
};

export const CATEGORY_TONE: Record<
  CostCodeCategory,
  'amber' | 'blue' | 'slate' | 'green' | 'purple'
> = {
  labor: 'amber',
  material: 'blue',
  equipment: 'slate',
  subcontract: 'green',
  other: 'purple',
};

const optionalTrimmed = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

export const costCodeFormSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(40, 'Code is too long')
    .regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, hyphen, underscore only'),
  description: z.string().min(1, 'Name is required').max(200),
  category: z.enum(costCodeCategoryValues),
  division: z
    .string()
    .trim()
    .max(8)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  sortOrder: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return 0;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : 0;
    }),
  // Optional default unit cost. Used as a price fallback on PO lines when
  // the picked inventory item has no defaultCost (or none is linked).
  // Empty string → null (no standing rate).
  defaultCost: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '' || v === null) return null;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) && n >= 0
        ? (Math.round(n * 100) / 100).toFixed(2)
        : null;
    }),
  notes: optionalTrimmed,
});

export type CostCodeFormValues = z.input<typeof costCodeFormSchema>;
export type CostCodeFormParsed = z.output<typeof costCodeFormSchema>;
