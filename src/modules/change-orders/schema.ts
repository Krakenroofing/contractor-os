import { z } from 'zod';

export const changeOrderStatusValues = [
  'draft',
  'pending_internal',
  'pending_customer',
  'approved',
  'rejected',
  'void',
] as const;
export type ChangeOrderStatus = (typeof changeOrderStatusValues)[number];

export const STATUS_LABEL: Record<ChangeOrderStatus, string> = {
  draft: 'Draft',
  pending_internal: 'Pending Internal',
  pending_customer: 'Pending Customer',
  approved: 'Approved',
  rejected: 'Rejected',
  void: 'Void',
};

export const STATUS_TONE: Record<
  ChangeOrderStatus,
  'slate' | 'blue' | 'amber' | 'green' | 'red'
> = {
  draft: 'slate',
  pending_internal: 'amber',
  pending_customer: 'amber',
  approved: 'green',
  rejected: 'red',
  void: 'slate',
};

export const changeOrderReasonValues = [
  'scope_change',
  'customer_request',
  'design_change',
  'conditions',
  'other',
] as const;
export type ChangeOrderReason = (typeof changeOrderReasonValues)[number];

export const REASON_LABEL: Record<ChangeOrderReason, string> = {
  scope_change: 'Scope change',
  customer_request: 'Customer request',
  design_change: 'Design change',
  conditions: 'Site conditions',
  other: 'Other',
};

const numericString = z
  .string()
  .refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, {
    message: 'Must be a non-negative number',
  });

export const changeOrderLineSchema = z.object({
  costCodeId: z.string().uuid('Pick a cost code'),
  description: z.string().min(1, 'Description is required').max(500),
  unit: z.string().max(20).optional().or(z.literal('')),
  quantity: numericString,
  unitCost: numericString,
  markupPercent: numericString,
});

export const changeOrderFormSchema = z.object({
  number: z.string().min(1, 'CO number is required').max(50),
  projectId: z.string().uuid('Pick a project'),
  proposalId: z.string().uuid().optional().or(z.literal('')),
  status: z.enum(changeOrderStatusValues).default('draft'),
  reason: z.enum(changeOrderReasonValues).default('scope_change'),
  description: z.string().min(1, 'Scope description is required').max(4000),
  scheduleImpactDays: z
    .string()
    .refine((v) => !Number.isNaN(Number(v)), 'Must be a number')
    .transform((v) => Number(v)),
  submittedAt: z.string().optional().or(z.literal('')),
  approvedAt: z.string().optional().or(z.literal('')),
  customerSignedName: z.string().max(200).optional().or(z.literal('')),
  lines: z.array(changeOrderLineSchema).min(1, 'At least one line item is required'),
});

export type ChangeOrderFormParsed = z.output<typeof changeOrderFormSchema>;
