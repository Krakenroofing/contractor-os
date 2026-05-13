// Client-safe status machine for the entire app.
//
// Defines the *canonical* status set per entity type and the legal transitions
// between them. Used by:
//   - <StatusBadge>          to render labels + tones
//   - <StatusActions>        to render legal next-step buttons
//   - transitionStatusAction to validate transitions on the server
//   - project status counts  to bucket entities consistently
//
// IMPORTANT: this file MUST stay client-safe. No 'server-only' imports, no
// mock-store imports. Cookies-aware permission checks happen server-side
// inside the action; this module only describes shape.

import type { Resource } from '@/lib/permissions';

// ===== Entity types =====

export const ENTITY_TYPES = [
  'estimate',
  'proposal',
  'change_order',
  'purchase_order',
  'invoice',
  'payment',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

// Permission resource that gates each entity type's transitions.
export const ENTITY_RESOURCE: Record<EntityType, Resource> = {
  estimate: 'estimates',
  proposal: 'proposals',
  change_order: 'change_orders',
  purchase_order: 'purchase_orders',
  invoice: 'invoices',
  payment: 'payments',
};

export const ENTITY_LABEL: Record<EntityType, string> = {
  estimate: 'Estimate',
  proposal: 'Proposal',
  change_order: 'Change order',
  purchase_order: 'Purchase order',
  invoice: 'Invoice',
  payment: 'Payment',
};

// ===== Canonical status sets =====

export const ESTIMATE_STATUSES = [
  'draft',
  'internal_review',
  'approved',
  'rejected',
] as const;
export type EstimateCanonStatus = (typeof ESTIMATE_STATUSES)[number];

export const PROPOSAL_STATUSES = [
  'draft',
  'sent',
  'approved',
  'rejected',
  'expired',
] as const;
export type ProposalCanonStatus = (typeof PROPOSAL_STATUSES)[number];

export const CHANGE_ORDER_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
] as const;
export type ChangeOrderCanonStatus = (typeof CHANGE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'issued',
  'partially_received',
  'received',
  'closed',
] as const;
export type PurchaseOrderCanonStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const INVOICE_STATUSES = [
  'draft',
  'sent',
  'partial',
  'paid',
  'overdue',
] as const;
export type InvoiceCanonStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'pending',
  'received',
  'returned',
  'applied',
] as const;
export type PaymentCanonStatus = (typeof PAYMENT_STATUSES)[number];

export type CanonStatus =
  | EstimateCanonStatus
  | ProposalCanonStatus
  | ChangeOrderCanonStatus
  | PurchaseOrderCanonStatus
  | InvoiceCanonStatus
  | PaymentCanonStatus;

// ===== Legacy → canonical normalization =====

const ESTIMATE_NORMALIZE: Record<string, EstimateCanonStatus> = {
  draft: 'draft',
  internal_review: 'internal_review',
  sent: 'internal_review', // legacy
  approved: 'approved',
  rejected: 'rejected',
};

const PROPOSAL_NORMALIZE: Record<string, ProposalCanonStatus> = {
  draft: 'draft',
  sent: 'sent',
  viewed: 'sent', // legacy — treat "viewed" as still in the sent state
  approved: 'approved',
  accepted: 'approved', // legacy
  rejected: 'rejected',
  declined: 'rejected', // legacy
  expired: 'expired',
};

const CO_NORMALIZE: Record<string, ChangeOrderCanonStatus | 'void'> = {
  draft: 'draft',
  submitted: 'submitted',
  pending_internal: 'submitted', // legacy
  pending_customer: 'submitted', // legacy
  approved: 'approved',
  rejected: 'rejected',
  void: 'void',
};

const PO_NORMALIZE: Record<string, PurchaseOrderCanonStatus | 'void'> = {
  draft: 'draft',
  issued: 'issued',
  partially_received: 'partially_received',
  received: 'received',
  closed: 'closed',
  void: 'void',
};

const INVOICE_NORMALIZE: Record<string, InvoiceCanonStatus | 'void'> = {
  draft: 'draft',
  sent: 'sent',
  partial: 'partial',
  paid: 'paid',
  overdue: 'overdue',
  void: 'void',
};

const PAYMENT_NORMALIZE: Record<string, PaymentCanonStatus> = {
  pending: 'pending',
  received: 'received',
  returned: 'returned',
  applied: 'applied',
};

export function normalizeStatus(entity: EntityType, raw: string): string {
  switch (entity) {
    case 'estimate':
      return ESTIMATE_NORMALIZE[raw] ?? raw;
    case 'proposal':
      return PROPOSAL_NORMALIZE[raw] ?? raw;
    case 'change_order':
      return CO_NORMALIZE[raw] ?? raw;
    case 'purchase_order':
      return PO_NORMALIZE[raw] ?? raw;
    case 'invoice':
      return INVOICE_NORMALIZE[raw] ?? raw;
    case 'payment':
      return PAYMENT_NORMALIZE[raw] ?? raw;
  }
}

// ===== Display: labels + badge tones =====

type Tone = 'slate' | 'blue' | 'green' | 'amber' | 'red';

const STATUS_DISPLAY: Record<string, { label: string; tone: Tone }> = {
  // shared
  draft: { label: 'Draft', tone: 'slate' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  expired: { label: 'Expired', tone: 'slate' },
  void: { label: 'Void', tone: 'slate' },

  // estimate / change order
  internal_review: { label: 'Internal review', tone: 'amber' },
  submitted: { label: 'Submitted', tone: 'amber' },

  // proposal / invoice
  sent: { label: 'Sent', tone: 'blue' },

  // purchase order
  issued: { label: 'Issued', tone: 'blue' },
  partially_received: { label: 'Partially received', tone: 'amber' },
  received: { label: 'Received', tone: 'green' },
  closed: { label: 'Closed', tone: 'slate' },

  // invoice
  partial: { label: 'Partially paid', tone: 'amber' },
  paid: { label: 'Paid', tone: 'green' },
  overdue: { label: 'Overdue', tone: 'red' },

  // payment
  pending: { label: 'Pending', tone: 'amber' },
  returned: { label: 'Returned', tone: 'red' },
  applied: { label: 'Applied', tone: 'green' },
};

export function statusDisplay(
  entity: EntityType,
  raw: string,
): { label: string; tone: Tone; canonical: string } {
  const canonical = normalizeStatus(entity, raw);
  const display = STATUS_DISPLAY[canonical] ?? { label: canonical, tone: 'slate' as Tone };
  return { ...display, canonical };
}

// ===== Transitions =====

export type Transition = {
  /** Stable action key used by the server action. */
  action: string;
  /** Button label shown to the user. */
  label: string;
  /** Resulting canonical status. */
  to: string;
  /** Visual hint for the button. */
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
};

type TransitionMap = Record<string, Transition[]>;

const ESTIMATE_TRANSITIONS: TransitionMap = {
  draft: [
    { action: 'submit', label: 'Submit for review', to: 'internal_review' },
    { action: 'approve', label: 'Approve', to: 'approved' },
  ],
  internal_review: [
    { action: 'approve', label: 'Approve', to: 'approved' },
    {
      action: 'reject',
      label: 'Reject',
      to: 'rejected',
      variant: 'outline',
    },
    { action: 'revert_draft', label: 'Back to draft', to: 'draft', variant: 'ghost' },
  ],
  approved: [
    {
      action: 'revert_review',
      label: 'Re-open for review',
      to: 'internal_review',
      variant: 'outline',
    },
  ],
  rejected: [
    { action: 'revert_draft', label: 'Re-open as draft', to: 'draft', variant: 'outline' },
  ],
};

const PROPOSAL_TRANSITIONS: TransitionMap = {
  draft: [{ action: 'mark_sent', label: 'Mark sent', to: 'sent' }],
  sent: [
    { action: 'approve', label: 'Mark approved', to: 'approved' },
    { action: 'reject', label: 'Mark rejected', to: 'rejected', variant: 'outline' },
    { action: 'expire', label: 'Mark expired', to: 'expired', variant: 'ghost' },
  ],
  approved: [],
  rejected: [
    { action: 'revert_sent', label: 'Re-open as sent', to: 'sent', variant: 'outline' },
  ],
  expired: [
    { action: 'revert_sent', label: 'Re-send', to: 'sent', variant: 'outline' },
  ],
};

// Void = soft-delete. The record stays in the DB so FKs (line items,
// activity log) keep their references, but voided rows are filtered out of
// list / dashboard views by default. Destructive variant on the button so
// the intent is clear.
//
// Voiding an APPROVED change order is a real operation, not a soft delete
// of an unimportant draft: the data layer reverses the contract-value and
// total-change-orders bumps that the original approval applied to the
// project. Label is more explicit to flag that side-effect to the user.
const VOID_CO_TRANSITION = {
  action: 'mark_void',
  label: 'Void',
  to: 'void',
  variant: 'destructive' as const,
};

const VOID_APPROVED_CO_TRANSITION = {
  action: 'mark_void',
  label: 'Void (reverses approval)',
  to: 'void',
  variant: 'destructive' as const,
};

const CO_TRANSITIONS: TransitionMap = {
  draft: [
    { action: 'submit', label: 'Submit', to: 'submitted' },
    VOID_CO_TRANSITION,
  ],
  submitted: [
    { action: 'approve', label: 'Approve', to: 'approved' },
    { action: 'reject', label: 'Reject', to: 'rejected', variant: 'outline' },
    { action: 'revert_draft', label: 'Back to draft', to: 'draft', variant: 'ghost' },
    VOID_CO_TRANSITION,
  ],
  approved: [VOID_APPROVED_CO_TRANSITION],
  rejected: [
    { action: 'revert_draft', label: 'Re-open as draft', to: 'draft', variant: 'outline' },
    VOID_CO_TRANSITION,
  ],
  void: [],
};

// PO void only from `draft` — once a PO is issued it may have receipts /
// inventory implications which require deliberate reversal. Draft POs are
// safe to void since no commitment has actually been made yet.
const VOID_PO_TRANSITION = {
  action: 'mark_void',
  label: 'Void',
  to: 'void',
  variant: 'destructive' as const,
};

const PO_TRANSITIONS: TransitionMap = {
  draft: [
    { action: 'issue', label: 'Issue PO', to: 'issued' },
    VOID_PO_TRANSITION,
  ],
  issued: [
    {
      action: 'mark_partially_received',
      label: 'Mark partially received',
      to: 'partially_received',
    },
    { action: 'mark_received', label: 'Mark received', to: 'received' },
  ],
  partially_received: [{ action: 'mark_received', label: 'Mark received', to: 'received' }],
  received: [{ action: 'close', label: 'Close PO', to: 'closed' }],
  closed: [],
  void: [],
};

// Every non-void state can be voided — it's the soft-delete path. Voided
// invoices stay in the database (so payment history, retainage, audit log
// all keep their FKs) but are filtered out of dashboard / AR / list by
// default. The transition is destructive in user terms, so the StatusPanel
// renders it with the destructive variant.
const VOID_INVOICE_TRANSITION = {
  action: 'mark_void',
  label: 'Void invoice',
  to: 'void',
  variant: 'destructive' as const,
};

const INVOICE_TRANSITIONS: TransitionMap = {
  draft: [
    { action: 'mark_sent', label: 'Mark sent', to: 'sent' },
    VOID_INVOICE_TRANSITION,
  ],
  sent: [
    { action: 'mark_paid', label: 'Mark paid', to: 'paid' },
    { action: 'mark_overdue', label: 'Mark overdue', to: 'overdue', variant: 'outline' },
    VOID_INVOICE_TRANSITION,
  ],
  partial: [
    { action: 'mark_paid', label: 'Mark paid', to: 'paid' },
    VOID_INVOICE_TRANSITION,
  ],
  paid: [VOID_INVOICE_TRANSITION],
  overdue: [
    { action: 'mark_paid', label: 'Mark paid', to: 'paid' },
    VOID_INVOICE_TRANSITION,
  ],
  void: [],
};

const PAYMENT_TRANSITIONS: TransitionMap = {
  pending: [
    { action: 'receive', label: 'Mark received', to: 'received' },
    { action: 'return', label: 'Mark returned', to: 'returned', variant: 'outline' },
  ],
  received: [
    { action: 'apply', label: 'Mark applied', to: 'applied' },
    { action: 'return', label: 'Mark returned', to: 'returned', variant: 'outline' },
  ],
  applied: [
    { action: 'return', label: 'Mark returned', to: 'returned', variant: 'outline' },
  ],
  returned: [],
};

const TRANSITIONS: Record<EntityType, TransitionMap> = {
  estimate: ESTIMATE_TRANSITIONS,
  proposal: PROPOSAL_TRANSITIONS,
  change_order: CO_TRANSITIONS,
  purchase_order: PO_TRANSITIONS,
  invoice: INVOICE_TRANSITIONS,
  payment: PAYMENT_TRANSITIONS,
};

export function getTransitions(
  entity: EntityType,
  rawStatus: string,
): Transition[] {
  const canonical = normalizeStatus(entity, rawStatus);
  return TRANSITIONS[entity][canonical] ?? [];
}

/**
 * Validate that an action is legal for the current status. Returns the target
 * canonical status if so, undefined otherwise.
 */
export function resolveTransition(
  entity: EntityType,
  rawStatus: string,
  action: string,
): Transition | undefined {
  return getTransitions(entity, rawStatus).find((t) => t.action === action);
}

// ===== Project status counts (categorize entities for the project summary) =====

export type ProjectStatusCounts = {
  // Open / in-flight
  draftEstimates: number;
  internalReviewEstimates: number;
  draftProposals: number;
  sentProposals: number;
  pendingChangeOrders: number;
  openPurchaseOrders: number;
  unpaidInvoices: number;
  overdueInvoices: number;
  // Done
  approvedEstimates: number;
  approvedProposals: number;
  approvedChangeOrders: number;
  closedPurchaseOrders: number;
  paidInvoices: number;
};

// Minimal row shape — works with anything that has a `.status` and (for
// invoices) `.dueDate`. Lets the project page pass mock-store rows directly.
type WithStatus = { status: string };
type InvoiceRow = WithStatus & { dueDate?: string | null };

function isOverdue(dueDate: string | null | undefined, asOf: Date): boolean {
  if (!dueDate) return false;
  const today = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
  const due = new Date(`${dueDate}T00:00:00Z`);
  return due.getTime() < today.getTime();
}

export function computeProjectStatusCounts(input: {
  estimates: WithStatus[];
  proposals: WithStatus[];
  changeOrders: WithStatus[];
  purchaseOrders: WithStatus[];
  invoices: InvoiceRow[];
  asOf?: Date;
}): ProjectStatusCounts {
  const asOf = input.asOf ?? new Date();
  let draftEstimates = 0;
  let internalReviewEstimates = 0;
  let approvedEstimates = 0;
  for (const e of input.estimates) {
    const c = normalizeStatus('estimate', e.status);
    if (c === 'draft') draftEstimates += 1;
    else if (c === 'internal_review') internalReviewEstimates += 1;
    else if (c === 'approved') approvedEstimates += 1;
  }

  let draftProposals = 0;
  let sentProposals = 0;
  let approvedProposals = 0;
  for (const p of input.proposals) {
    const c = normalizeStatus('proposal', p.status);
    if (c === 'draft') draftProposals += 1;
    else if (c === 'sent') sentProposals += 1;
    else if (c === 'approved') approvedProposals += 1;
  }

  let pendingChangeOrders = 0;
  let approvedChangeOrders = 0;
  for (const co of input.changeOrders) {
    const c = normalizeStatus('change_order', co.status);
    if (c === 'submitted' || c === 'draft') pendingChangeOrders += 1;
    else if (c === 'approved') approvedChangeOrders += 1;
  }

  let openPurchaseOrders = 0;
  let closedPurchaseOrders = 0;
  for (const po of input.purchaseOrders) {
    const c = normalizeStatus('purchase_order', po.status);
    if (c === 'closed' || c === 'void') closedPurchaseOrders += 1;
    else openPurchaseOrders += 1;
  }

  let unpaidInvoices = 0;
  let overdueInvoices = 0;
  let paidInvoices = 0;
  for (const inv of input.invoices) {
    const c = normalizeStatus('invoice', inv.status);
    if (c === 'paid') {
      paidInvoices += 1;
    } else if (c !== 'void') {
      unpaidInvoices += 1;
      if (c === 'overdue' || (c === 'sent' && isOverdue(inv.dueDate, asOf))) {
        overdueInvoices += 1;
      }
    }
  }

  return {
    draftEstimates,
    internalReviewEstimates,
    draftProposals,
    sentProposals,
    pendingChangeOrders,
    openPurchaseOrders,
    unpaidInvoices,
    overdueInvoices,
    approvedEstimates,
    approvedProposals,
    approvedChangeOrders,
    closedPurchaseOrders,
    paidInvoices,
  };
}
