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

// ===== Receiving (Phase 6.1) =====

export const poReceiptLineFormSchema = z.object({
  poLineId: z.string().uuid('Invalid line id'),
  quantityReceived: z
    .string()
    .refine((v) => v.trim() === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0), {
      message: 'Must be a non-negative number',
    }),
});

export const poReceiptFormSchema = z.object({
  purchaseOrderId: z.string().uuid('Invalid purchase order id'),
  receivedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date'),
  notes: z.string().max(2000).optional().or(z.literal('')),
  // Phase 6.4: location is optional at parse-time so legacy callers /
  // tooling don't break; the action resolves to the company default
  // when not provided.
  locationId: z.string().uuid('Pick a stock location').optional().or(z.literal('')),
  lines: z.array(poReceiptLineFormSchema).min(1, 'No lines to receive'),
});

export type PoReceiptFormParsed = z.output<typeof poReceiptFormSchema>;

// ===== PDF upload + create-from-extracted (Phase 6.2) =====

export const extractedPoLineSchema = z.object({
  inventoryItemId: z.string().uuid().optional().or(z.literal('')),
  costCodeId: z.string().uuid('Pick a cost code'),
  description: z.string().min(1, 'Description is required').max(500),
  unit: z.string().max(20).optional().or(z.literal('')),
  quantity: numericString,
  unitCost: numericString,
});

export const createPoFromExtractedSchema = z.object({
  // PO header
  number: z.string().min(1, 'PO number is required').max(50),
  vendorId: z.string().uuid('Pick a vendor'),
  projectId: z.string().uuid('Pick a project'),
  issueDate: z.string().optional().or(z.literal('')),
  expectedDeliveryDate: z.string().optional().or(z.literal('')),
  taxAmount: numericString,
  shipping: numericString,
  notes: z.string().max(2000).optional().or(z.literal('')),
  lines: z.array(extractedPoLineSchema).min(1, 'At least one line item is required'),

  // Source PDF info — produced by extractPoPdfAction and round-tripped via
  // hidden inputs so we can re-upload it as a project document after the
  // PO exists (and clean up the temp file).
  sourceStoragePath: z.string().min(1),
  sourceFileName: z.string().min(1),
  sourceMimeType: z.string().min(1),
  sourceByteSize: z.coerce.number().int().nonnegative(),
});

export type CreatePoFromExtractedParsed = z.output<typeof createPoFromExtractedSchema>;
