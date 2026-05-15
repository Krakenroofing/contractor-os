import { z } from 'zod';
import {
  AMOUNT_STRATEGIES,
  DATE_FORMATS,
} from './lib/mapping';

export const bankAccountTypeValues = ['bank', 'credit_card'] as const;
export const BANK_ACCOUNT_TYPE_LABEL: Record<
  (typeof bankAccountTypeValues)[number],
  string
> = {
  bank: 'Bank',
  credit_card: 'Credit Card',
};

export const createBankAccountSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  type: z.enum(bankAccountTypeValues),
  last4: z
    .string()
    .trim()
    .max(8)
    .optional()
    .default('')
    .transform((v) => (v === '' ? null : v)),
  currency: z.string().trim().min(3).max(3).toUpperCase(),
  openingBalance: z.string().trim().default('0'),
  openingDate: z
    .string()
    .trim()
    .optional()
    .default('')
    .transform((v) => (v === '' ? null : v)),
});

export type CreateBankAccountInput = z.infer<typeof createBankAccountSchema>;

// Saved-mapping payload. Validated server-side before insert/update.
export const columnMapSchema = z.object({
  date: z.string().trim().min(1, 'Date column is required'),
  postedDate: z.string().trim().optional().default(''),
  description: z.string().trim().min(1, 'Description column is required'),
  payee: z.string().trim().optional().default(''),
  memo: z.string().trim().optional().default(''),
  amount: z.string().trim().optional().default(''),
  debit: z.string().trim().optional().default(''),
  credit: z.string().trim().optional().default(''),
  reference: z.string().trim().optional().default(''),
});

export const mappingSettingsSchema = z.object({
  label: z.string().trim().min(1).max(120).default('Default mapping'),
  dateFormat: z.enum(DATE_FORMATS),
  amountStrategy: z.enum(AMOUNT_STRATEGIES),
  decimalSeparator: z.enum(['.', ',']).default('.'),
  thousandsSeparator: z.enum([',', '.', ' ', '']).default(','),
  skipRows: z.coerce.number().int().min(0).max(50).default(0),
  columnMap: columnMapSchema,
});
export type MappingSettings = z.infer<typeof mappingSettingsSchema>;

export const updateImportedTransactionSchema = z.object({
  id: z.string().uuid(),
  accountingAccountId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? null : v)),
  projectId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? null : v)),
  costCodeId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? null : v)),
  isReviewed: z.coerce.boolean().optional(),
  isIgnored: z.coerce.boolean().optional(),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .default('')
    .transform((v) => (v === '' ? null : v)),
});
export type UpdateImportedTransactionInput = z.infer<
  typeof updateImportedTransactionSchema
>;
