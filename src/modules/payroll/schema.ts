import { z } from 'zod';

export const timeEntryTypeValues = ['hours', 'amount'] as const;
export type TimeEntryType = (typeof timeEntryTypeValues)[number];

export const TIME_ENTRY_TYPE_LABEL: Record<TimeEntryType, string> = {
  hours: 'Hours',
  amount: 'Pay amount',
};

const moneyString = z
  .string()
  .trim()
  .default('0')
  .transform((v) => (v === '' ? '0' : v))
  .refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, {
    message: 'Enter a non-negative number',
  });

const hoursString = z
  .string()
  .trim()
  .default('0')
  .transform((v) => (v === '' ? '0' : v))
  .refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, {
    message: 'Enter a non-negative number',
  })
  .refine((v) => Number(v) <= 24, {
    message: 'Hours cannot exceed 24 per day',
  });

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

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

// Common shape for both entry types. Hours / amount required-ness is
// enforced by the refine() below so the user can leave the unused field
// blank without a validation error.
export const timeEntryFormSchema = z
  .object({
    employeeId: z.string().uuid('Pick an employee'),
    workDate: isoDate,
    entryType: z.enum(timeEntryTypeValues).default('hours'),
    hours: hoursString,
    amount: moneyString,
    projectId: nullableUuid,
    costCodeId: nullableUuid,
    notes: z.string().max(2000).optional().or(z.literal('')),
  })
  .refine(
    (d) => d.entryType !== 'hours' || Number(d.hours) > 0,
    { path: ['hours'], message: 'Hours must be greater than zero' },
  )
  .refine(
    (d) => d.entryType !== 'amount' || Number(d.amount) > 0,
    { path: ['amount'], message: 'Amount must be greater than zero' },
  );

export type TimeEntryFormParsed = z.output<typeof timeEntryFormSchema>;
