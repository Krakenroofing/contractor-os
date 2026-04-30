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
  'settings',
] as const;
export type Resource = (typeof RESOURCES)[number];

export type Action = 'view' | 'create';

const READ: Action[] = ['view'];
const RW: Action[] = ['view', 'create'];
const NONE: Action[] = [];

const PERMS: Record<Role, Record<Resource, Action[]>> = {
  owner: {
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
    settings: RW,
  },
  project_manager: {
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
    settings: NONE,
  },
  estimator: {
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
    settings: NONE,
  },
  accounting: {
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
    settings: NONE,
  },
  field_user: {
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
    settings: NONE,
  },
  view_only: {
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
