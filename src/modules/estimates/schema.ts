import { z } from 'zod';

// Canonical status set for estimates. The legacy 'sent' value still works on
// existing rows and is normalized to 'internal_review' for display via
// @/lib/status-machine.
export const estimateStatusValues = [
  'draft',
  'internal_review',
  'sent', // legacy alias of internal_review
  'approved',
  'rejected',
] as const;
export type EstimateStatus = (typeof estimateStatusValues)[number];

export const STATUS_LABEL: Record<EstimateStatus, string> = {
  draft: 'Draft',
  internal_review: 'Internal review',
  sent: 'Internal review',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const STATUS_TONE: Record<EstimateStatus, 'slate' | 'blue' | 'amber' | 'green' | 'red'> = {
  draft: 'slate',
  internal_review: 'amber',
  sent: 'amber',
  approved: 'green',
  rejected: 'red',
};

const numericString = z
  .string()
  .refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, {
    message: 'Must be a non-negative number',
  });

export const estimateLineSchema = z.object({
  costCodeId: z.string().uuid('Pick a cost code'),
  inventoryItemId: z.string().uuid().optional().or(z.literal('')),
  description: z.string().min(1, 'Description is required').max(500),
  unit: z.string().max(20).optional().or(z.literal('')),
  quantity: numericString,
  unitCost: numericString,
  markupPercent: numericString,
});

export const estimateFormSchema = z.object({
  number: z.string().min(1, 'Estimate number is required').max(50),
  projectId: z.string().uuid('Pick a project'),
  status: z.enum(estimateStatusValues).default('draft'),
  validUntil: z.string().optional().or(z.literal('')),
  lines: z.array(estimateLineSchema).min(1, 'At least one line item is required'),
});

export type EstimateFormParsed = z.output<typeof estimateFormSchema>;
export type EstimateLineParsed = z.output<typeof estimateLineSchema>;
