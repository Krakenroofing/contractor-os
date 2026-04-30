import { pgEnum } from 'drizzle-orm/pg-core';

export const membershipRoleEnum = pgEnum('membership_role', [
  'owner',
  'admin',
  'project_manager',
  'estimator',
  'office_admin',
  'field_lead',
  'accountant',
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
  'sent',
  'approved',
  'rejected',
]);

export const proposalStatusEnum = pgEnum('proposal_status', [
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired',
]);

export const changeOrderStatusEnum = pgEnum('change_order_status', [
  'draft',
  'pending_internal',
  'pending_customer',
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
