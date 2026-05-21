import { z } from 'zod';

const hoursString = z
  .string()
  .trim()
  .refine((v) => v !== '' && !Number.isNaN(Number(v)) && Number(v) > 0, {
    message: 'Hours must be greater than zero',
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

export const timeEntryFormSchema = z.object({
  employeeId: z.string().uuid('Pick an employee'),
  workDate: isoDate,
  hours: hoursString,
  projectId: nullableUuid,
  costCodeId: nullableUuid,
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type TimeEntryFormParsed = z.output<typeof timeEntryFormSchema>;
