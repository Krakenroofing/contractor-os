// Client-safe shared types + helpers for parsing report filter query params.
// Used by both the page renderers and the CSV route handlers.

import { canView, type Resource, type Role } from '@/lib/permissions';

export type ReportFilters = {
  /** Inclusive lower bound, ISO YYYY-MM-DD. Empty string = no lower bound. */
  from: string;
  /** Inclusive upper bound, ISO YYYY-MM-DD. Empty string = no upper bound. */
  to: string;
  /** Project filter (UUID). Empty string = all projects. */
  projectId: string;
  /** Customer filter (UUID). Empty string = all customers. Currently honoured
   *  only by the customer-summary report. */
  customerId: string;
};

export const REPORT_TYPES = [
  'project-financial',
  'job-cost',
  'accounts-receivable',
  'accounts-payable',
  'profit-loss',
  'wip',
  'invoice-summary',
  'payment-summary',
  'purchase-orders',
  'landed-cost',
  'vat-quarterly',
  'vendor-vat',
  'customer-summary',
  'nib-monthly',
  'payroll-summary',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_LABEL: Record<ReportType, string> = {
  'project-financial': 'Project Financial Report',
  'job-cost': 'Job Cost Report',
  'accounts-receivable': 'Accounts Receivable Report',
  'accounts-payable': 'Accounts Payable Report',
  'profit-loss': 'Profit & Loss (Income Statement)',
  'wip': 'Work in Progress (WIP)',
  'invoice-summary': 'Invoice Summary Report',
  'payment-summary': 'Payment Summary Report',
  'purchase-orders': 'Purchase Order Summary',
  'landed-cost': 'Landed Cost Summary',
  'vat-quarterly': 'VAT Quarterly Report',
  'vendor-vat': 'Vendor VAT Breakdown',
  'customer-summary': 'Customer Summary Report',
  'nib-monthly': 'NIB Monthly Report (C-10)',
  'payroll-summary': 'Payroll Summary Report',
};

export const REPORT_DESCRIPTION: Record<ReportType, string> = {
  'project-financial':
    'Per-project rollup: contract, change orders, invoiced, paid, AR, retainage, cost, GP, margin.',
  'job-cost':
    'Estimated vs. committed vs. actual cost across projects, with category breakdown.',
  'accounts-receivable':
    'Aging buckets per customer with overdue invoices flagged.',
  'accounts-payable':
    'Open commitments aged by vendor: open POs (not closed/void) + approved-but-unpaid subcontractor payments. Choose a default Net term for vendors without one on file.',
  'profit-loss':
    'Income statement: revenue (invoiced ex-VAT), cost of goods sold by operational category, gross profit, operating expenses by category, and net income. Accrual basis — invoices count when sent, costs when posted.',
  'wip':
    'Work in Progress — per-project contract value, cost-to-date, % complete (cost basis), revenue earned, billed-to-date, over/(under) billing, and projected gross profit. The classic surety/banker report for active contracts.',
  'invoice-summary':
    'List of invoices with line totals, status, balance due, and rolled-up totals.',
  'payment-summary':
    'List of payments by method and status, with running totals.',
  'purchase-orders':
    'PO commitments by status with vendor + project breakdown.',
  'landed-cost':
    'Landed-cost imports with CIF, duty, VAT, and per-unit cost.',
  'vat-quarterly':
    'Accrual-basis VAT liability by quarter — every sent invoice with VAT, grouped by quarter of sent date.',
  'vendor-vat':
    'Bank-feed expenses grouped by VAT-registered vendor. For each, splits gross spend into material cost (ex-VAT) and VAT paid using the vendor’s rate. Requires the vendor (payee) to be set on each expense.',
  'customer-summary':
    'Pick a customer — see every project they own with contract, billed, still billable, collected, and a list of their invoices.',
  'nib-monthly':
    'Bahamas C-10 monthly filing: pick a month, see per-employee gross / insurable / employee NIB / employer NIB / remittance. Read straight onto the C-10 form.',
  'payroll-summary':
    'Per-employee payroll roll-up across any date range: hours, gross, deductions, NIB, reimbursements / per diem / expenses, net, and fully-loaded labor cost. Includes NIB-exempt staff.',
};

/**
 * Money-side reports require this resource on top of `reports`, mirroring
 * the per-page gates — so a role locked out of financials (e.g. PM) keeps
 * the operational reports (job cost, WIP, POs, landed cost) but never sees
 * links to the financial ones.
 */
export const REPORT_EXTRA_RESOURCE: Partial<Record<ReportType, Resource>> = {
  'project-financial': 'invoices',
  'accounts-receivable': 'accounts_receivable',
  'accounts-payable': 'accounting_accounts',
  'profit-loss': 'accounting_accounts',
  'invoice-summary': 'invoices',
  'payment-summary': 'payments',
  'vat-quarterly': 'accounting_accounts',
  'vendor-vat': 'accounting_accounts',
  'customer-summary': 'invoices',
  'nib-monthly': 'payroll',
  'payroll-summary': 'payroll',
};

export function canViewReportType(role: Role, type: ReportType): boolean {
  const extra = REPORT_EXTRA_RESOURCE[type];
  return !extra || canView(role, extra);
}

/**
 * Whether a particular report supports a project filter (some are
 * cross-project by nature — payments, AR — and ignore the filter).
 */
export const REPORT_SUPPORTS_PROJECT_FILTER: Record<ReportType, boolean> = {
  'project-financial': true,
  'job-cost': true,
  'accounts-receivable': false,
  // AP is vendor-oriented and cross-project — POs and sub payments roll up
  // by vendor regardless of which project they hit. Project filter would
  // confuse the "what do I owe whom" workflow.
  'accounts-payable': false,
  // P&L is company-wide by design — net income across all projects.
  // A future per-project P&L would live as a section in the project-financial
  // report, not as a filter here.
  'profit-loss': false,
  // WIP supports project filter so a PM can pull a single-project view
  // for a banker / surety meeting.
  'wip': true,
  'invoice-summary': true,
  'payment-summary': true,
  'purchase-orders': true,
  'landed-cost': true,
  'vat-quarterly': false,
  'vendor-vat': false,
  'customer-summary': false,
  'nib-monthly': false,
  'payroll-summary': false,
};

/**
 * Whether a report supports filtering by customer. Today only the
 * customer-summary report does — the rest treat customer as a per-project
 * dimension and use the project filter instead.
 */
export const REPORT_SUPPORTS_CUSTOMER_FILTER: Record<ReportType, boolean> = {
  'project-financial': false,
  'job-cost': false,
  'accounts-receivable': false,
  'accounts-payable': false,
  'profit-loss': false,
  'wip': false,
  'invoice-summary': false,
  'payment-summary': false,
  'purchase-orders': false,
  'landed-cost': false,
  'vat-quarterly': false,
  'vendor-vat': false,
  'customer-summary': true,
  'nib-monthly': false,
  'payroll-summary': false,
};

export function parseReportFilters(
  searchParams: Record<string, string | string[] | undefined>,
): ReportFilters {
  const get = (k: string): string => {
    const v = searchParams[k];
    if (!v) return '';
    return Array.isArray(v) ? (v[0] ?? '') : v;
  };
  return {
    from: get('from'),
    to: get('to'),
    projectId: get('projectId'),
    customerId: get('customerId'),
  };
}

/**
 * Returns true if `iso` (YYYY-MM-DD) is within [filters.from, filters.to]
 * inclusive. Empty filter bounds are treated as -∞ / +∞.
 */
export function isInRange(iso: string | null | undefined, filters: ReportFilters): boolean {
  if (!iso) return false;
  if (filters.from && iso < filters.from) return false;
  if (filters.to && iso > filters.to) return false;
  return true;
}

export function describeRange(filters: ReportFilters): string {
  const f = filters.from || '—';
  const t = filters.to || 'today';
  return `${f} → ${t}`;
}

/**
 * Build an export.csv URL for a given report + filters. Includes only
 * non-empty filter params. Optional `extras` lets reports pass their own
 * params (AP Aging uses this for `defaultTermsDays`).
 */
export function buildCsvUrl(
  type: ReportType,
  filters: ReportFilters,
  extras?: Record<string, string>,
): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (filters.customerId) params.set('customerId', filters.customerId);
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      if (v) params.set(k, v);
    }
  }
  const qs = params.toString();
  return `/reports/${type}/export.csv${qs ? `?${qs}` : ''}`;
}

// ===== AP-aging-specific helpers =====

/** Allowed default-net-terms values when a vendor's defaultTerms field is
 *  blank or unparseable. Surfaced as a dropdown on the AP Aging report. */
export const AP_DEFAULT_TERMS_DAYS = [0, 15, 30] as const;
export type ApDefaultTermsDays = (typeof AP_DEFAULT_TERMS_DAYS)[number];

export function parseApDefaultTermsDays(
  raw: string | undefined,
): ApDefaultTermsDays {
  const n = Number(raw);
  if (n === 0 || n === 15 || n === 30) return n;
  return 30;
}

/** Parse "Net 30" / "net15" / "NET 45" / "Due on receipt" from the free-text
 *  vendors.defaultTerms column. Returns days, or null if unparseable. */
export function parseNetTerms(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  if (t === '' || t === 'due on receipt' || t === 'cod' || t === 'cash') {
    return 0;
  }
  const m = /net\s*(\d{1,3})/i.exec(text);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 365) return n;
  }
  return null;
}
