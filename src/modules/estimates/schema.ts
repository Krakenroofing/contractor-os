import { z } from 'zod';

export const estimateStatusValues = ['draft', 'sent', 'approved', 'rejected'] as const;
export type EstimateStatus = (typeof estimateStatusValues)[number];

export const STATUS_LABEL: Record<EstimateStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const STATUS_TONE: Record<EstimateStatus, 'slate' | 'blue' | 'green' | 'red'> = {
  draft: 'slate',
  sent: 'blue',
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
