import { z } from 'zod';

export const invoiceStatusValues = [
  'draft',
  'sent',
  'partial',
  'paid',
  'overdue',
  'void',
] as const;
export type InvoiceStatus = (typeof invoiceStatusValues)[number];

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partial: 'Partial',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
};

export const STATUS_TONE: Record<InvoiceStatus, 'slate' | 'blue' | 'amber' | 'green' | 'red'> = {
  draft: 'slate',
  sent: 'blue',
  partial: 'amber',
  paid: 'green',
  overdue: 'red',
  void: 'slate',
};

export const billingTypeValues = [
  'progress',
  'milestone',
  'final',
  'retainage',
  'change_order',
  'deposit',
] as const;
export type BillingType = (typeof billingTypeValues)[number];

export const BILLING_TYPE_LABEL: Record<BillingType, string> = {
  progress: 'Progress',
  milestone: 'Milestone',
  final: 'Final',
  retainage: 'Retainage',
  change_order: 'Change order',
  deposit: 'Deposit',
};

const optionalString = z.string().optional().or(z.literal(''));

const numericString = z
  .string()
  .refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, {
    message: 'Must be a non-negative number',
  });

export const invoiceLineSchema = z.object({
  description: z.string().min(1, 'Description is required').max(500),
  unit: optionalString,
  quantity: numericString,
  unitCost: numericString,
});

export const invoiceFormSchema = z.object({
  number: z.string().min(1, 'Invoice number is required').max(50),
  projectId: z.string().uuid('Pick a project'),
  proposalId: optionalString,
  changeOrderId: optionalString,
  templateId: optionalString,
  status: z.enum(invoiceStatusValues).default('draft'),
  billingType: z.enum(billingTypeValues).default('progress'),
  invoiceDate: z.string().min(1, 'Invoice date is required'),
  dueDate: optionalString,
  taxAmount: numericString,
  retainagePercent: numericString.optional().or(z.literal('')),
  retainageAmount: numericString,
  expectedRetainageReleaseDate: optionalString,
  amountPaid: numericString,
  notes: z.string().max(2000).optional().or(z.literal('')),
  termsOverride: z.string().max(4000).optional().or(z.literal('')),
  lines: z.array(invoiceLineSchema).min(1, 'At least one line item is required'),
});

export type InvoiceFormParsed = z.output<typeof invoiceFormSchema>;
