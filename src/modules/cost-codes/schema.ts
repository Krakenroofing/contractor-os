import { z } from 'zod';

export const costCodeCategoryValues = [
  'labor',
  'material',
  'equipment',
  'subcontract',
] as const;

export type CostCodeCategory = (typeof costCodeCategoryValues)[number];

export const CATEGORY_LABEL: Record<CostCodeCategory, string> = {
  labor: 'Labor',
  material: 'Material',
  equipment: 'Equipment',
  subcontract: 'Subcontract',
};

export const CATEGORY_TONE: Record<CostCodeCategory, 'amber' | 'blue' | 'slate' | 'green'> = {
  labor: 'amber',
  material: 'blue',
  equipment: 'slate',
  subcontract: 'green',
};

export const costCodeFormSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(20, 'Code is too long')
    .regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, hyphen, underscore only'),
  description: z.string().min(1, 'Name is required').max(200),
  category: z.enum(costCodeCategoryValues),
});

export type CostCodeFormValues = z.input<typeof costCodeFormSchema>;
export type CostCodeFormParsed = z.output<typeof costCodeFormSchema>;
