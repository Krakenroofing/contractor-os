import { z } from 'zod';

// Canonical status set for proposals. Legacy values (viewed/accepted/declined)
// are still accepted on existing rows and normalized for display via
// @/lib/status-machine.
export const proposalStatusValues = [
  'draft',
  'sent',
  'viewed',
  'approved',
  'accepted', // legacy alias of approved
  'rejected',
  'declined', // legacy alias of rejected
  'expired',
] as const;
export type ProposalStatus = (typeof proposalStatusValues)[number];

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Sent', // canonical display: still in "sent" state
  approved: 'Approved',
  accepted: 'Approved', // canonical display
  rejected: 'Rejected',
  declined: 'Rejected', // canonical display
  expired: 'Expired',
};

export const STATUS_TONE: Record<ProposalStatus, 'slate' | 'blue' | 'amber' | 'green' | 'red'> = {
  draft: 'slate',
  sent: 'blue',
  viewed: 'blue',
  approved: 'green',
  accepted: 'green',
  rejected: 'red',
  declined: 'red',
  expired: 'slate',
};

const optionalString = z.string().optional().or(z.literal(''));

export const proposalFormSchema = z.object({
  number: z.string().min(1, 'Proposal number is required').max(50),
  estimateId: z.string().uuid('Pick an estimate'),
  status: z.enum(proposalStatusValues).default('draft'),
  proposalDate: optionalString,
  expiryDate: optionalString,
  scopeOfWork: z.string().max(8000).optional().or(z.literal('')),
  inclusions: z.string().max(4000).optional().or(z.literal('')),
  exclusions: z.string().max(4000).optional().or(z.literal('')),
  paymentSchedule: z.string().max(4000).optional().or(z.literal('')),
  warrantyNotes: z.string().max(4000).optional().or(z.literal('')),
  termsAndConditions: z.string().max(8000).optional().or(z.literal('')),
});

export type ProposalFormParsed = z.output<typeof proposalFormSchema>;
