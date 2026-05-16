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
  // Phase 2: receipts post into job_cost_entries via this source. The enum
  // value is added now in the banking-phase1 migration so future phases
  // don't need a separate enum migration.
  'receipt_import',
]);

export const jobCostTypeEnum = pgEnum('job_cost_type', [
  'labor',
  'labor_burden',
  'materials',
  'subcontractor',
  'equipment_rental',
  'owned_equipment',
  'freight',
  'customs_duty',
  'vat',
  'tools_consumables',
  'fuel_travel',
  'per_diem_housing',
  'permits_fees',
  'disposal',
  'general_conditions',
  'change_order_work',
  'other',
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
  'lump_sum',
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

// Banking & Receipts — Phase 1.
//
// accounting_method drives downstream VAT reporting and (later) cash-basis
// P&L behavior. accrual is the default; TRB and most active operators run
// accrual.
export const accountingMethodEnum = pgEnum('accounting_method', [
  'accrual',
  'cash',
]);

// Lightweight COA — not a full GL yet. Categorizes accounting_accounts and
// is the target of manual categorization on imported transactions.
export const accountingAccountTypeEnum = pgEnum('accounting_account_type', [
  'bank',
  'credit_card',
  'income',
  'expense',
  'cogs_job_cost',
  'vat_payable',
  'vat_input',
  'owner_equity',
  'uncategorized_income',
  'uncategorized_expense',
]);

export const bankAccountTypeEnum = pgEnum('bank_account_type', [
  'bank',
  'credit_card',
]);

export const statementImportStatusEnum = pgEnum('statement_import_status', [
  'pending',
  'mapped',
  'imported',
  'failed',
]);

// Receipts. 'submitted' added in Phase 2.2 — the holding state between a
// field user uploading and an approver posting. Lifecycle:
//   draft ──submit──▶ submitted ──approve & post──▶ posted
//         ◀──reject──┘
export const receiptStatusEnum = pgEnum('receipt_status', [
  'draft',
  'submitted',
  'posted',
  'void',
]);

export const paymentSourceTypeEnum = pgEnum('payment_source_type', [
  'bank',
  'credit_card',
  'cash',
  'other',
]);

export const receiptAttachmentKindEnum = pgEnum('receipt_attachment_kind', [
  'receipt_image',
  'supplier_invoice',
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
