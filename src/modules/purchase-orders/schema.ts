import { z } from 'zod';

export const poStatusValues = [
  'draft',
  'issued',
  'partially_received',
  'received',
  'closed',
  'void',
] as const;
export type POStatus = (typeof poStatusValues)[number];

// User-facing labels: draft → "Pending", issued → "Ordered" per spec.
export const STATUS_LABEL: Record<POStatus, string> = {
  draft: 'Pending',
  issued: 'Ordered',
  partially_received: 'Partially Received',
  received: 'Received',
  closed: 'Closed',
  void: 'Void',
};

export const STATUS_TONE: Record<POStatus, 'slate' | 'blue' | 'amber' | 'green' | 'red'> = {
  draft: 'slate',
  issued: 'blue',
  partially_received: 'amber',
  received: 'green',
  closed: 'slate',
  void: 'red',
};

const numericString = z
  .string()
  .refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, {
    message: 'Must be a non-negative number',
  });

export const poLineSchema = z.object({
  costCodeId: z.string().uuid('Pick a cost code'),
  inventoryItemId: z.string().uuid().optional().or(z.literal('')),
  description: z.string().min(1, 'Description is required').max(500),
  unit: z.string().max(20).optional().or(z.literal('')),
  quantity: numericString,
  unitCost: numericString,
});

export const purchaseOrderFormSchema = z.object({
  number: z.string().min(1, 'PO number is required').max(50),
  projectId: z.string().uuid('Pick a project'),
  vendorId: z.string().uuid('Pick a vendor'),
  landedCostEntryId: z.string().uuid().optional().or(z.literal('')),
  status: z.enum(poStatusValues).default('draft'),
  issueDate: z.string().optional().or(z.literal('')),
  expectedDeliveryDate: z.string().optional().or(z.literal('')),
  taxAmount: numericString,
  shipping: numericString,
  notes: z.string().max(2000).optional().or(z.literal('')),
  lines: z.array(poLineSchema).min(1, 'At least one line item is required'),
});

export type PurchaseOrderFormParsed = z.output<typeof purchaseOrderFormSchema>;
