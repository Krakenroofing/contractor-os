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

/**
 * Special sentinel that the project picker emits when "Overhead" is
 * selected. The form transports it as a string so it can sit in a
 * normal HTML <select>; the action translates it into
 * is_overhead = true with project_id = null.
 */
export const OVERHEAD_VALUE = '__overhead__';

const projectSelection = z
  .string()
  .transform((v) => (v === '' ? null : v))
  .refine(
    (v) =>
      v === null ||
      v === OVERHEAD_VALUE ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    { message: 'Invalid project selection' },
  );

const percentString = z
  .string()
  .transform((v) => (v === '' ? '0' : v))
  .pipe(
    z.coerce
      .number()
      .min(0.01, 'Percent must be greater than zero')
      .max(100, 'Percent cannot exceed 100'),
  );

/** One row of the multi-allocation widget on the create form. */
export const timeEntryAllocationSchema = z.object({
  projectId: projectSelection,
  costCodeId: nullableUuid,
  percent: percentString,
});

export type TimeEntryAllocation = z.output<typeof timeEntryAllocationSchema>;

/**
 * Schema for the CREATE form. Carries one or more allocations whose
 * percents must sum to 100. The action splits the entry into N
 * time_entries rows, each receiving its proportional share of
 * hours / amount.
 */
export const timeEntryCreateSchema = z
  .object({
    employeeId: z.string().uuid('Pick an employee'),
    workDate: isoDate,
    entryType: z.enum(timeEntryTypeValues).default('hours'),
    hours: hoursString,
    amount: moneyString,
    notes: z.string().max(2000).optional().or(z.literal('')),
    allocations: z
      .array(timeEntryAllocationSchema)
      .min(1, 'Add at least one allocation'),
  })
  .refine(
    (d) => d.entryType !== 'hours' || Number(d.hours) > 0,
    { path: ['hours'], message: 'Hours must be greater than zero' },
  )
  .refine(
    (d) => d.entryType !== 'amount' || Number(d.amount) > 0,
    { path: ['amount'], message: 'Amount must be greater than zero' },
  )
  .refine(
    (d) => {
      const sum = d.allocations.reduce((s, a) => s + a.percent, 0);
      // Allow tiny floating-point slop. UI keeps to 0.01 resolution.
      return Math.abs(sum - 100) <= 0.01;
    },
    { path: ['allocations'], message: 'Allocations must add up to 100%' },
  );

export type TimeEntryCreateParsed = z.output<typeof timeEntryCreateSchema>;

/**
 * Schema for the EDIT form. Each row stands alone after creation, so
 * editing operates on a single (project | overhead, cost code) pair —
 * no allocations array, no percent.
 */
export const timeEntryEditSchema = z
  .object({
    employeeId: z.string().uuid('Pick an employee'),
    workDate: isoDate,
    entryType: z.enum(timeEntryTypeValues).default('hours'),
    hours: hoursString,
    amount: moneyString,
    projectId: projectSelection,
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

export type TimeEntryEditParsed = z.output<typeof timeEntryEditSchema>;
