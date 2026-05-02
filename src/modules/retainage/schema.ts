import { z } from 'zod';

const optionalString = z.string().optional().or(z.literal(''));

const positiveAmount = z
  .string()
  .refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) > 0, {
    message: 'Amount must be greater than zero',
  });

export const retainageReleaseFormSchema = z.object({
  releaseNumber: z.string().min(1, 'Release number is required').max(50),
  invoiceId: z.string().uuid('Pick an invoice with retainage'),
  releaseDate: z.string().min(1, 'Release date is required'),
  amount: positiveAmount,
  paymentId: optionalString,
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type RetainageReleaseFormParsed = z.output<typeof retainageReleaseFormSchema>;
