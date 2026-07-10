import { z } from 'zod';

export const projectStatusValues = [
  'lead',
  'estimating',
  'won',
  'in_progress',
  'closed',
  'lost',
] as const;

export const projectTypeValues = ['production', 'service'] as const;

const optionalString = z.string().optional().or(z.literal(''));

const moneyString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : '0'))
  .refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, 'Must be a non-negative number');

// Optional non-negative number → trimmed string, or null when blank. Used for
// the T&M billing defaults (bill rate, markup %) which only apply to service
// projects and may be left empty.
const optionalMoneyOrNull = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : null))
  .refine(
    (v) => v === null || (!Number.isNaN(Number(v)) && Number(v) >= 0),
    'Must be a non-negative number',
  );

export const projectFormSchema = z
  .object({
    customerId: z.string().uuid('Pick a customer'),
    name: z.string().min(1, 'Name is required').max(200),
    status: z.enum(projectStatusValues).default('lead'),
    projectType: z.enum(projectTypeValues).default('production'),
    jobsiteAddressLine1: optionalString,
    jobsiteCity: optionalString,
    jobsiteState: optionalString,
    jobsitePostalCode: optionalString,
    startDate: optionalString,
    targetCompletionDate: optionalString,
    contractValue: moneyString,
    estimatedBudget: moneyString,
    tmLaborBillRate: optionalMoneyOrNull,
    tmMaterialMarkupPct: optionalMoneyOrNull,
    // Fallback labor cost code for clock-posted hours on this job. Empty = use
    // the company default. Kept as an optional string; the action nulls blanks.
    defaultLaborCostCodeId: z.string().optional().or(z.literal('')),
    notes: z.string().max(2000).optional().or(z.literal('')),
  })
  .transform((data) => {
    // Service projects have no signed contract value — the contract /
    // change-order / draws machinery doesn't apply. Force it to 0 so a stray
    // value typed before switching type can't leak in. (Estimated budget stays
    // usable as a not-to-exceed / expected-cost figure.) Production jobs clear
    // the T&M-only defaults for the same reason.
    if (data.projectType === 'service') {
      return { ...data, contractValue: '0' };
    }
    return { ...data, tmLaborBillRate: null, tmMaterialMarkupPct: null };
  });

export type ProjectFormValues = z.input<typeof projectFormSchema>;
export type ProjectFormParsed = z.output<typeof projectFormSchema>;
