import { z } from 'zod';

const optionalString = z.string().optional().or(z.literal(''));

const numericString = z
  .string()
  .refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, {
    message: 'Must be a non-negative number',
  });

export const companySettingsFormSchema = z.object({
  name: z.string().min(1, 'Company name is required').max(200),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: optionalString,
  website: optionalString,
  licenseNumber: optionalString,
  addressLine1: optionalString,
  city: optionalString,
  state: optionalString,
  postalCode: optionalString,
  defaultCurrency: z.string().min(1, 'Required').max(10),
  defaultMarkupPercent: numericString,
  taxRatePercent: numericString,
  vatRatePercent: numericString,
  proposalValidityDays: z
    .string()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 0, 'Must be a non-negative integer'),
  standardPaymentTerms: z.string().max(4000).optional().or(z.literal('')),
  standardWarrantyLanguage: z.string().max(4000).optional().or(z.literal('')),
});

export type CompanySettingsFormParsed = z.output<typeof companySettingsFormSchema>;
