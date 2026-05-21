import { z } from 'zod';

export const employmentTypeValues = ['hourly', 'salaried'] as const;
export type EmploymentType = (typeof employmentTypeValues)[number];

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  hourly: 'Hourly',
  salaried: 'Salaried',
};

export const EMPLOYMENT_TYPE_TONE: Record<EmploymentType, 'blue' | 'green'> = {
  hourly: 'blue',
  salaried: 'green',
};

const optionalString = z.string().optional().or(z.literal(''));

// Money / rate strings get the same regex treatment as invoice line items —
// validated at the form layer, stored as numeric strings for drizzle.
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
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type EmployeeFormParsed = z.output<typeof employeeFormSchema>;
