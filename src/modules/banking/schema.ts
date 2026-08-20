import { z } from 'zod';
import {
  AMOUNT_STRATEGIES,
  DATE_FORMATS,
} from './lib/mapping';
import {
  APPLIES_TO_VALUES,
  MATCHER_FIELDS,
  MATCHER_OPS,
  RULE_MATCH_MODES,
} from './lib/rules';

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
  vendorId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? null : v)),
  paymentMethodId: z
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

// ===== Banking Rules — Phase 1 =====

export const matcherSchema = z.object({
  field: z.enum(MATCHER_FIELDS),
  op: z.enum(MATCHER_OPS),
  value: z.string().trim().min(1, 'Match value is required').max(500),
  case_sensitive: z.coerce.boolean().optional().default(false),
});
export type MatcherInput = z.infer<typeof matcherSchema>;

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

const nullableAmount = z
  .string()
  .optional()
  .or(z.literal(''))
  .transform((v) => {
    if (v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

export const ruleActionPayloadSchema = z.object({
  accountingAccountId: nullableUuid,
  projectId: nullableUuid,
  costCodeId: nullableUuid,
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .default('')
    .transform((v) => (v === '' ? null : v)),
  // Optional payee the rule stamps on matched transactions.
  vendorId: nullableUuid,
  // When set, the rule splits each matched (VAT-inclusive) transaction into a
  // net cost line (→ accountingAccountId) + a VAT Input line.
  autoVatSplit: z.coerce.boolean().optional().default(false),
  // Explicit rate override for the split. When null, the engine falls back to
  // the stamped vendor's rate, then the company standard VAT rate.
  vatRateOverride: nullableAmount,
});
export type RuleActionPayloadInput = z.infer<typeof ruleActionPayloadSchema>;

export const upsertRuleSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Name is required').max(160),
  enabled: z.coerce.boolean().optional().default(true),
  priority: z.coerce.number().int().min(0).max(10_000).default(100),
  appliesTo: z.enum(APPLIES_TO_VALUES).default('all'),
  matchMode: z.enum(RULE_MATCH_MODES).default('all'),
  bankAccountId: nullableUuid,
  amountMin: nullableAmount,
  amountMax: nullableAmount,
  matchers: z.array(matcherSchema).min(1, 'Add at least one condition').max(10),
  actions: ruleActionPayloadSchema,
});
export type UpsertRuleInput = z.infer<typeof upsertRuleSchema>;

