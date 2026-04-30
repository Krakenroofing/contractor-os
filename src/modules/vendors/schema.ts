import { z } from 'zod';

export const vendorTypeValues = ['supplier', 'subcontractor'] as const;
export type VendorType = (typeof vendorTypeValues)[number];

export const TYPE_LABEL: Record<VendorType, string> = {
  supplier: 'Supplier',
  subcontractor: 'Subcontractor',
};

export const TYPE_TONE: Record<VendorType, 'slate' | 'green'> = {
  supplier: 'slate',
  subcontractor: 'green',
};

const optionalString = z.string().optional().or(z.literal(''));

export const vendorFormSchema = z.object({
  name: z.string().min(1, 'Company name is required').max(200),
  vendorType: z.enum(vendorTypeValues).default('supplier'),
  primaryContactName: optionalString,
  email: z
    .string()
    .email('Invalid email')
    .optional()
    .or(z.literal('')),
  phone: optionalString,
  addressLine1: optionalString,
  city: optionalString,
  state: optionalString,
  postalCode: optionalString,
  defaultTerms: z.string().max(100).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type VendorFormParsed = z.output<typeof vendorFormSchema>;
