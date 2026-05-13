import { pgEnum } from 'drizzle-orm/pg-core';

// Canonical app-level roles. Kept in lock-step with the ROLES tuple in
// @/lib/permissions so the DB enum value and the app-level Role union are
// the same string set — no normalization needed when reading a membership.
export const membershipRoleEnum = pgEnum('membership_role', [
  'owner',
  'project_manager',
  'estimator',
  'accounting',
  'field_user',
  'view_only',
]);

export const membershipStatusEnum = pgEnum('membership_status', [
  'active',
  'invited',
  'suspended',
]);

export const customerTypeEnum = pgEnum('customer_type', [
  'residential',
  'commercial',
]);

export const projectStatusEnum = pgEnum('project_status', [
  'lead',
  'estimating',
  'won',
  'in_progress',
  'closed',
  'lost',
]);

export const costCodeCategoryEnum = pgEnum('cost_code_category', [
  'labor',
  'material',
  'subcontract',
  'equipment',
  'other',
]);

export const estimateStatusEnum = pgEnum('estimate_status', [
  'draft',
  'internal_review',
  'sent', // legacy — normalized to internal_review for display
  'approved',
  'rejected',
]);

export const proposalStatusEnum = pgEnum('proposal_status', [
  'draft',
  'sent',
  'viewed', // legacy — normalized to sent for display
  'approved',
  'accepted', // legacy — normalized to approved
  'rejected',
  'declined', // legacy — normalized to rejected
  'expired',
]);

export const changeOrderStatusEnum = pgEnum('change_order_status', [
  'draft',
  'submitted',
  'pending_internal', // legacy — normalized to submitted for display
  'pending_customer', // legacy — normalized to submitted for display
  'approved',
  'rejected',
  'void',
]);

export const changeOrderReasonEnum = pgEnum('change_order_reason', [
  'scope_change',
  'customer_request',
  'design_change',
  'conditions',
  'other',
]);

export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', [
  'draft',
  'issued',
  'partially_received',
  'received',
  'closed',
  'void',
]);

export const jobCostSourceEnum = pgEnum('job_cost_source', [
  'manual',
  'po_receipt',
  'labor_entry',
  'bill_import',
  'qbo_sync',
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'sent',
  'partial',
  'paid',
  'overdue',
  'void',
]);

export const invoiceBillingTypeEnum = pgEnum('invoice_billing_type', [
  'progress',
  'milestone',
  'final',
  'retainage',
  'change_order',
  'deposit',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'received',
  'applied',
  'returned',
]);

export const paymentMethodEnum = pgEnum('payment_method', [
  'ach',
  'wire',
  'check',
  'credit_card',
  'cash',
  'other',
]);

export const retainageStatusEnum = pgEnum('retainage_status', [
  'held',
  'partially_released',
  'released',
  'overdue',
]);

export const dailyReportStatusEnum = pgEnum('daily_report_status', [
  'draft',
  'complete',
  'exported',
  'sent_to_client',
  'void',
]);

export const dailyReportPhotoCategoryEnum = pgEnum('daily_report_photo_category', [
  'progress',
  'safety',
  'issue',
  'delivery',
  'inspection',
  'weather',
  'other',
]);

export const documentCategoryEnum = pgEnum('document_category', [
  'proposal',
  'estimate',
  'invoice',
  'contract',
  'permit',
  'drawing',
  'photo',
  'daily_report',
  'submittal',
  'warranty',
  'closeout',
  'financial',
  'other',
]);
