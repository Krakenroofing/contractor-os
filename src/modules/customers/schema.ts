import { z } from 'zod';

export const customerTypeValues = ['residential', 'commercial'] as const;
export type CustomerType = (typeof customerTypeValues)[number];

const optionalString = z.string().optional().or(z.literal(''));

export const customerFormSchema = z.object({
  name: z.string().min(1, 'Company name is required').max(200),
  customerType: z.enum(customerTypeValues).default('residential'),
  primaryContactName: optionalString,
  email: z
    .string()
    .email('Invalid email')
    .optional()
    .or(z.literal('')),
  phone: optionalString,
  billingAddressLine1: optionalString,
  billingCity: optionalString,
  billingState: optionalString,
  billingPostalCode: optionalString,
  tinNumber: optionalString,
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type CustomerFormValues = z.input<typeof customerFormSchema>;
export type CustomerFormParsed = z.output<typeof customerFormSchema>;
