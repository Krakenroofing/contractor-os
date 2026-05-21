import { z } from 'zod';

export const subPaymentStatusValues = [
  'draft',
  'approved',
  'paid',
  'void',
] as const;
export type SubPaymentStatus = (typeof subPaymentStatusValues)[number];

export const STATUS_LABEL: Record<SubPaymentStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  paid: 'Paid',
  void: 'Void',
};

export const STATUS_TONE: Record<
  SubPaymentStatus,
  'slate' | 'blue' | 'green' | 'red'
> = {
  draft: 'slate',
  approved: 'blue',
  paid: 'green',
  void: 'red',
};

const moneyString = z
  .string()
  .trim()
  .refine((v) => v !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, {
    message: 'Enter a non-negative number',
  });

const percentString = z
  .string()
  .trim()
  .refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 100), {
    message: 'Percent must be between 0 and 100',
  })
  .default('0');

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

const optionalDate = z
  .string()
  .optional()
  .or(z.literal(''))
  .refine((v) => v === '' || v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: 'Date must be YYYY-MM-DD',
  });

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

export const subPaymentFormSchema = z
  .object({
    vendorId: z.string().uuid('Pick a subcontractor'),
    projectId: nullableUuid,
    workPeriodStart: isoDate,
    workPeriodEnd: isoDate,
    scopeDescription: z
      .string()
      .trim()
      .min(1, 'Describe what was completed')
      .max(2000),
    grossAmount: moneyString,
    retainagePercent: percentString,
    retainageHeld: moneyString.default('0'),
    paidDate: optionalDate,
    status: z.enum(subPaymentStatusValues).default('draft'),
    notes: z.string().max(2000).optional().or(z.literal('')),
  })
  .refine((d) => d.workPeriodStart <= d.workPeriodEnd, {
    path: ['workPeriodEnd'],
    message: 'End date must be on or after the start date',
  })
  .refine((d) => Number(d.retainageHeld) <= Number(d.grossAmount), {
    path: ['retainageHeld'],
    message: 'Retainage held cannot exceed gross amount',
  });

export type SubPaymentFormParsed = z.output<typeof subPaymentFormSchema>;
