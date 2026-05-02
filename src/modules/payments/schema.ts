import { z } from 'zod';

export const paymentMethodValues = [
  'ach',
  'wire',
  'check',
  'credit_card',
  'cash',
  'other',
] as const;
export type PaymentMethod = (typeof paymentMethodValues)[number];

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  ach: 'ACH',
  wire: 'Wire',
  check: 'Check',
  credit_card: 'Credit card',
  cash: 'Cash',
  other: 'Other',
};

export const paymentStatusValues = [
  'pending',
  'received',
  'applied',
  'returned',
] as const;
export type PaymentStatus = (typeof paymentStatusValues)[number];

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'Pending',
  received: 'Received',
  applied: 'Applied',
  returned: 'Returned',
};

export const STATUS_TONE: Record<PaymentStatus, 'amber' | 'blue' | 'green' | 'red'> = {
  pending: 'amber',
  received: 'blue',
  applied: 'green',
  returned: 'red',
};

const optionalString = z.string().optional().or(z.literal(''));

const positiveAmount = z
  .string()
  .refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) > 0, {
    message: 'Amount must be greater than zero',
  });

export const paymentFormSchema = z.object({
  paymentNumber: z.string().min(1, 'Payment number is required').max(50),
  invoiceId: z.string().uuid('Pick an invoice'),
  paidDate: z.string().min(1, 'Payment date is required'),
  amount: positiveAmount,
  method: z.enum(paymentMethodValues),
  reference: optionalString,
  bankAccount: optionalString,
  status: z.enum(paymentStatusValues).default('received'),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type PaymentFormParsed = z.output<typeof paymentFormSchema>;
