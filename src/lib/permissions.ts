export const ROLES = [
  'owner',
  'project_manager',
  'estimator',
  'accounting',
  'field_user',
  'view_only',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner / Admin',
  project_manager: 'Project Manager',
  estimator: 'Estimator',
  accounting: 'Accounting',
  field_user: 'Field User',
  view_only: 'View Only',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Full access',
  project_manager: 'Projects, customers, POs, change orders, job-costing view',
  estimator: 'Estimates, proposals, cost codes',
  accounting: 'POs, vendors, landed cost, job costing',
  field_user: 'Projects (view only)',
  view_only: 'Read-only across all modules',
};

export const RESOURCES = [
  'dashboard',
  'projects',
  'customers',
  'vendors',
  'cost_codes',
  'estimates',
  'proposals',
  'change_orders',
  'purchase_orders',
  'landed_cost',
  'job_costing',
  'invoices',
  'invoice_templates',
  'payments',
  'accounts_receivable',
  'retainage',
  'backfill',
  'reconciliation',
  'reports',
  'settings',
] as const;
export type Resource = (typeof RESOURCES)[number];

export type Action = 'view' | 'create';

const READ: Action[] = ['view'];
const RW: Action[] = ['view', 'create'];
const NONE: Action[] = [];

const PERMS: Record<Role, Record<Resource, Action[]>> = {
  owner: {
    dashboard: READ,
    projects: RW,
    customers: RW,
    vendors: RW,
    cost_codes: RW,
    estimates: RW,
    proposals: RW,
    change_orders: RW,
    purchase_orders: RW,
    landed_cost: RW,
    job_costing: RW,
    invoices: RW,
    invoice_templates: RW,
    payments: RW,
    accounts_receivable: RW,
    retainage: RW,
    backfill: RW,
    reconciliation: RW,
    reports: RW,
    settings: RW,
  },
  project_manager: {
    dashboard: READ,
    projects: RW,
    customers: RW,
    vendors: READ,
    cost_codes: READ,
    estimates: READ,
    proposals: READ,
    change_orders: RW,
    purchase_orders: RW,
    landed_cost: READ,
    job_costing: READ,
    invoices: RW,
    invoice_templates: READ,
    payments: RW,
    accounts_receivable: READ,
    retainage: RW,
    backfill: NONE,
    reconciliation: READ,
    reports: RW,
    settings: NONE,
  },
  estimator: {
    dashboard: READ,
    projects: READ,
    customers: READ,
    vendors: READ,
    cost_codes: RW,
    estimates: RW,
    proposals: RW,
    change_orders: NONE,
    purchase_orders: NONE,
    landed_cost: NONE,
    job_costing: NONE,
    invoices: NONE,
    invoice_templates: NONE,
    payments: NONE,
    accounts_receivable: NONE,
    retainage: NONE,
    backfill: NONE,
    reconciliation: NONE,
    reports: READ,
    settings: NONE,
  },
  accounting: {
    dashboard: READ,
    projects: READ,
    customers: READ,
    vendors: RW,
    cost_codes: READ,
    estimates: READ,
    proposals: READ,
    change_orders: READ,
    purchase_orders: RW,
    landed_cost: RW,
    job_costing: READ,
    invoices: RW,
    invoice_templates: RW,
    payments: RW,
    accounts_receivable: RW,
    retainage: RW,
    backfill: RW,
    reconciliation: RW,
    reports: RW,
    settings: NONE,
  },
  field_user: {
    dashboard: READ,
    projects: READ,
    customers: NONE,
    vendors: NONE,
    cost_codes: NONE,
    estimates: NONE,
    proposals: NONE,
    change_orders: NONE,
    purchase_orders: NONE,
    landed_cost: NONE,
    job_costing: NONE,
    invoices: NONE,
    invoice_templates: NONE,
    payments: NONE,
    accounts_receivable: NONE,
    retainage: NONE,
    backfill: NONE,
    reconciliation: NONE,
    reports: NONE,
    settings: NONE,
  },
  view_only: {
    dashboard: READ,
    projects: READ,
    customers: READ,
    vendors: READ,
    cost_codes: READ,
    estimates: READ,
    proposals: READ,
    change_orders: READ,
    purchase_orders: READ,
    landed_cost: READ,
    job_costing: READ,
    invoices: READ,
    invoice_templates: READ,
    payments: READ,
    accounts_receivable: READ,
    retainage: READ,
    backfill: READ,
    reconciliation: READ,
    reports: READ,
    settings: NONE,
  },
};

export function can(role: Role, resource: Resource, action: Action): boolean {
  return PERMS[role][resource].includes(action);
}

export function canView(role: Role, resource: Resource): boolean {
  return can(role, resource, 'view');
}

export function canCreate(role: Role, resource: Resource): boolean {
  return can(role, resource, 'create');
}
