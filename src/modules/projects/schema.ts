import { z } from 'zod';

export const projectStatusValues = [
  'lead',
  'estimating',
  'won',
  'in_progress',
  'closed',
  'lost',
] as const;

const optionalString = z.string().optional().or(z.literal(''));

const moneyString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : '0'))
  .refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, 'Must be a non-negative number');

export const projectFormSchema = z.object({
  customerId: z.string().uuid('Pick a customer'),
  number: z.string().min(1, 'Project number is required').max(50),
  name: z.string().min(1, 'Name is required').max(200),
  status: z.enum(projectStatusValues).default('lead'),
  jobsiteAddressLine1: optionalString,
  jobsiteCity: optionalString,
  jobsiteState: optionalString,
  jobsitePostalCode: optionalString,
  startDate: optionalString,
  targetCompletionDate: optionalString,
  contractValue: moneyString,
  estimatedBudget: moneyString,
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type ProjectFormValues = z.input<typeof projectFormSchema>;
export type ProjectFormParsed = z.output<typeof projectFormSchema>;
