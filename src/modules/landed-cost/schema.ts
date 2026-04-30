import { z } from 'zod';

const optionalString = z.string().optional().or(z.literal(''));

const numericString = z
  .string()
  .refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, {
    message: 'Must be a non-negative number',
  });

export const landedCostFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  projectId: z.string().uuid('Pick a project'),
  vendorId: z.string().uuid().optional().or(z.literal('')),
  purchaseOrderId: z.string().uuid().optional().or(z.literal('')),
  carrier: z.string().min(1, 'Pick a carrier').max(100),
  itemDescription: z.string().max(500).optional().or(z.literal('')),
  tariffCode: optionalString,
  quantity: numericString,
  unitCost: numericString,
  flDelivery: numericString,
  crating: numericString,
  freightCost: numericString,
  insurance: numericString,
  dutyPercent: numericString,
  vatPercent: numericString,
  envLevyPercent: numericString,
  excisePercent: numericString,
  brokerage: numericString,
  portFees: numericString,
  localDelivery: numericString,
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type LandedCostFormParsed = z.output<typeof landedCostFormSchema>;
