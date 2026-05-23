import { z } from 'zod';

const optionalText = z.string().optional().or(z.literal(''));

const numericString = z
  .string()
  .refine((v) => v.trim() === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0), {
    message: 'Must be a non-negative number',
  });

export const inventoryItemFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  category: z.string().max(120).optional().or(z.literal('')),
  sku: z.string().max(60).optional().or(z.literal('')),
  unit: z.string().max(20).optional().or(z.literal('')),
  defaultCost: numericString,
  defaultCostCodeId: z.string().uuid().optional().or(z.literal('')),
  isTaxable: z.enum(['yes', 'no']).default('yes'),
  qbGlAccountText: optionalText,
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type InventoryItemFormParsed = z.output<typeof inventoryItemFormSchema>;
