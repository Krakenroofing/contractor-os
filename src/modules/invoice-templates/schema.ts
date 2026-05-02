import { z } from 'zod';

export const headerLayoutValues = ['standard', 'compact', 'detailed'] as const;
export const lineItemLayoutValues = ['detailed', 'summary', 'lumpsum'] as const;

const optionalString = z.string().optional().or(z.literal(''));

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === 'on' || v === 'true');

export const invoiceTemplateFormSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(200),
  description: z.string().max(500).optional().or(z.literal('')),
  isDefault: checkbox,
  showCompanyBranding: checkbox,
  showHeader: checkbox,
  showLineItems: checkbox,
  showPaymentTerms: checkbox,
  showRetainage: checkbox,
  showTaxVat: checkbox,
  showNotes: checkbox,
  showSignature: checkbox,
  showFooter: checkbox,
  headerLayout: z.enum(headerLayoutValues).default('standard'),
  lineItemLayout: z.enum(lineItemLayoutValues).default('detailed'),
  headerNote: optionalString,
  paymentTermsText: optionalString,
  retainageText: optionalString,
  notesText: optionalString,
  footerText: optionalString,
});

export type InvoiceTemplateFormParsed = z.output<typeof invoiceTemplateFormSchema>;

export const SECTION_LABEL = {
  showCompanyBranding: 'Company branding',
  showHeader: 'Header layout',
  showLineItems: 'Line items',
  showPaymentTerms: 'Payment terms',
  showRetainage: 'Retainage block',
  showTaxVat: 'Tax / VAT block',
  showNotes: 'Notes block',
  showSignature: 'Signature / approval block',
  showFooter: 'Footer text',
} as const;

export const HEADER_LAYOUT_LABEL: Record<
  (typeof headerLayoutValues)[number],
  string
> = {
  standard: 'Standard',
  compact: 'Compact',
  detailed: 'Detailed (open-book)',
};

export const LINE_ITEM_LAYOUT_LABEL: Record<
  (typeof lineItemLayoutValues)[number],
  string
> = {
  detailed: 'Detailed (one row per item)',
  summary: 'Summary (grouped)',
  lumpsum: 'Lump sum (single line)',
};
