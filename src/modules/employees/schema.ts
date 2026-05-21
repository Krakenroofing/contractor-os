import { z } from 'zod';

export const employmentTypeValues = [
  'hourly',
  'salaried',
  'piecework',
  'contract',
  'commission',
  'lump_sum',
] as const;
export type EmploymentType = (typeof employmentTypeValues)[number];

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  hourly: 'Hourly',
  salaried: 'Salaried',
  piecework: 'Piecework',
  contract: 'Contract',
  commission: 'Sales commission',
  lump_sum: 'Lump sum',
};

export const EMPLOYMENT_TYPE_TONE: Record<
  EmploymentType,
  'blue' | 'green' | 'amber' | 'slate' | 'purple' | 'red'
> = {
  hourly: 'blue',
  salaried: 'green',
  piecework: 'amber',
  contract: 'purple',
  commission: 'red',
  lump_sum: 'slate',
};

/**
 * Short label for the pay rate field, contextual to employment type.
 * Hourly: "$/hour". Salaried: "$/week". Everything else for now:
 * "Per period" (gross = the stored rate, paid out each period). Per-type
 * math (pieces × rate, % of sales, etc.) is a follow-up phase.
 */
export const PAY_RATE_BASIS_LABEL: Record<EmploymentType, string> = {
  hourly: '$/hour',
  salaried: '$/week',
  piecework: 'Per period',
  contract: 'Per period',
  commission: 'Per period',
  lump_sum: 'Per period',
};

/** Short hint shown under the pay rate input. */
export const PAY_RATE_HINT: Record<EmploymentType, string> = {
  hourly: 'Multiplied by hours logged each week to compute gross.',
  salaried: 'Paid each week regardless of hours logged. NIB capped at $710/week.',
  piecework:
    'Flat amount paid each period for now. Per-piece math will come in a later phase.',
  contract:
    'Flat amount paid each period. Set to whatever was contracted for the work.',
  commission:
    'Flat amount paid each period. Per-sale % math will come in a later phase.',
  lump_sum:
    'Flat amount paid each period until set back to zero.',
};

const optionalString = z.string().optional().or(z.literal(''));

const moneyString = z
  .string()
  .trim()
  .refine((v) => v !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, {
    message: 'Enter a non-negative number',
  });

const optionalDate = z
  .string()
  .optional()
  .or(z.literal(''))
  .refine((v) => v === '' || v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: 'Date must be YYYY-MM-DD',
  });

export const employeeFormSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(120),
  lastName: z.string().trim().min(1, 'Last name is required').max(120),
  nibNumber: z.string().trim().max(50).optional().or(z.literal('')),
  email: z
    .string()
    .email('Invalid email')
    .optional()
    .or(z.literal('')),
  phone: optionalString,
  employmentType: z.enum(employmentTypeValues).default('hourly'),
  payRate: moneyString.default('0'),
  hireDate: optionalDate,
  terminationDate: optionalDate,
  active: z.coerce.boolean().default(true),
  nibExempt: z.coerce.boolean().default(false),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type EmployeeFormParsed = z.output<typeof employeeFormSchema>;
