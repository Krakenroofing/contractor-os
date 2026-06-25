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
  // VAT rate is owned by the Accounting Settings form (/settings/accounting),
  // not here — keep it out so saving the company profile can't clobber it.
  proposalValidityDays: z
    .string()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 0, 'Must be a non-negative integer'),
  standardPaymentTerms: z.string().max(4000).optional().or(z.literal('')),
  standardWarrantyLanguage: z.string().max(4000).optional().or(z.literal('')),

  // Phase 1 banking / TIN fields. All optional — used by the wire-instructions
  // section on invoices when an invoice template enables that section.
  tinNumber: z.string().max(100).optional().or(z.literal('')),
  bankName: z.string().max(200).optional().or(z.literal('')),
  bankBranch: z.string().max(200).optional().or(z.literal('')),
  bankAccountName: z.string().max(200).optional().or(z.literal('')),
  bankAccountNumber: z.string().max(100).optional().or(z.literal('')),
  bankAddress: z.string().max(500).optional().or(z.literal('')),
  paymentNotes: z.string().max(2000).optional().or(z.literal('')),
});

export type CompanySettingsFormParsed = z.output<typeof companySettingsFormSchema>;
