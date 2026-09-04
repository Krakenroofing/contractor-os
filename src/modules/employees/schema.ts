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
  hourly:
    'Default hourly rate. Multiplied by hours logged each week to compute gross. Can be overridden per week from the Pay Run tab.',
  salaried:
    'Weekly salary. Can be overridden per week from the Pay Run tab. NIB capped at $810/week.',
  piecework:
    'Optional. Pay varies by pieces completed — enter gross each week from the Pay Run tab.',
  contract:
    'Optional. Pay varies by contract scope — enter gross each week from the Pay Run tab.',
  commission:
    'Optional. Pay varies by sales — enter gross each week from the Pay Run tab.',
  lump_sum:
    'Optional. Pay is entered each week from the Pay Run tab.',
};

const optionalString = z.string().optional().or(z.literal(''));

// Money input that accepts empty string and treats it as '0'. Used for
// pay rates that may be optional — piecework / commission / contract /
// lump-sum employees often have no fixed rate (pay is entered each week
// via Pay Run instead).
const optionalMoneyString = z
  .string()
  .trim()
  .default('0')
  .transform((v) => (v === '' ? '0' : v))
  .refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, {
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
  payRate: optionalMoneyString,
  hireDate: optionalDate,
  terminationDate: optionalDate,
  active: z.coerce.boolean().default(true),
  nibExempt: z.coerce.boolean().default(false),
  // NIB coverage start — periods ending before this date compute with no
  // NIB. Blank = covered from the start.
  nibStartDate: optionalDate,
  isSubcontractor: z.coerce.boolean().default(false),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type EmployeeFormParsed = z.output<typeof employeeFormSchema>;
