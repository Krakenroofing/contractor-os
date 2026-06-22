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

// production = the classic fixed-contract + change-orders + draws job.
// service    = T&M work (no contract value; billed from labor hours +
//              materials actually spent, marked up). Both Kraken and TRB run
//              service accounts; most service work is Time & Materials.
export const projectTypeEnum = pgEnum('project_type', ['production', 'service']);

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
  // Time & Materials — invoices on service projects (see projectTypeEnum).
  // Added to the DB via 2026-06-22_invoice_billing_type_tm.sql.
  't_m',
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
  // Generic balance-sheet leaf types for operator-managed categories. The
  // rollup_group enum already carries the statement section; these give the
  // `type` column a neutral value for Asset / Liability / Equity categories
  // (reserved system types like owner_equity/bank/credit_card stay distinct).
  'asset',
  'liability',
  'equity',
]);

// Phase 1 operational accounting: every account also belongs to one of the
// standard financial-statement groups so P&L, dashboards, and reports can
// aggregate without walking the parent_id tree. Distinct from `type`
// (which is about usage); see the rollup_group migration for the mapping.
export const accountRollupGroupEnum = pgEnum('account_rollup_group', [
  'income',
  'cogs',
  'opex',
  'asset',
  'liability',
  'equity',
  'vat_tax',
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

// Phase 6.3: types of inventory_movements ledger rows. Signed quantity
// convention: 'received' / 'adjustment' / 'transfer_in' are positive,
// 'issued_to_job' / 'transfer_out' are negative. 'adjustment' is the
// only one that can be either sign (over-count vs short-count).
export const inventoryMovementTypeEnum = pgEnum('inventory_movement_type', [
  'received',
  'issued_to_job',
  'adjustment',
  'transfer_in',
  'transfer_out',
]);

// Credit memo lifecycle. Status flows:
//   draft → issued → (partially_applied → applied) | refunded | void
// 'partially_applied' = some but not all of the credit has been consumed.
// 'refunded' = fully consumed via one or more cash_refund applications.
// 'applied' = fully consumed via invoice applications (or a mix).
export const creditMemoStatusEnum = pgEnum('credit_memo_status', [
  'draft',
  'issued',
  'partially_applied',
  'applied',
  'refunded',
  'void',
]);

// How a credit memo gets consumed: against an invoice's net billed value,
// or as a cash refund out the door.
export const creditMemoApplicationKindEnum = pgEnum('credit_memo_application_kind', [
  'invoice_application',
  'cash_refund',
]);
