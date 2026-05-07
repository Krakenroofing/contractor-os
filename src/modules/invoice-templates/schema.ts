import { z } from 'zod';

export const headerLayoutValues = ['standard', 'compact', 'detailed'] as const;
export const lineItemLayoutValues = ['detailed', 'summary', 'lumpsum'] as const;

const optionalString = z.string().optional().or(z.literal(''));

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === 'on' || v === 'true');

const numericString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : '0'))
  .refine(
    (v) => !Number.isNaN(Number(v)) && Number(v) >= 0,
    'Must be a non-negative number',
  );

export const invoiceTemplateFormSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(200),
  description: z.string().max(500).optional().or(z.literal('')),
  isDefault: checkbox,

  // ===== Existing toggles =====
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

  // ===== Phase 1 additions =====
  titleOverride: optionalString,
  tinLabel: optionalString,
  issuedByLabel: optionalString,

  showBillToTin: checkbox,
  billToAttentionLabel: optionalString,

  showProjectMetadata: checkbox,
  poNumberLabel: optionalString,
  billingNumberLabel: optionalString,
  projectDescriptionLabel: optionalString,

  showWireInstructions: checkbox,
  wireInstructionsNote: optionalString,

  showQualifications: checkbox,
  qualificationsText: optionalString,

  showAccountHistory: checkbox,
  accountHistoryLabel: optionalString,

  showProgressBilling: checkbox,
  progressBillingLabel: optionalString,
  contractValueLabel: optionalString,
  changeOrdersLabel: optionalString,
  priorBilledLabel: optionalString,
  retainageHeldLabel: optionalString,

  vatLabel: optionalString,
  vatRatePercent: numericString,
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
  showBillToTin: 'Bill-to TIN line',
  showProjectMetadata: 'Project metadata block (PO, billing #, description)',
  showWireInstructions: 'Wire / bank instructions',
  showQualifications: 'Qualifications & exclusions',
  showAccountHistory: 'Account history (prior invoices)',
  showProgressBilling: 'Progress billing summary',
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
