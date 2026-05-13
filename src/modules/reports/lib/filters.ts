// Client-safe shared types + helpers for parsing report filter query params.
// Used by both the page renderers and the CSV route handlers.

export type ReportFilters = {
  /** Inclusive lower bound, ISO YYYY-MM-DD. Empty string = no lower bound. */
  from: string;
  /** Inclusive upper bound, ISO YYYY-MM-DD. Empty string = no upper bound. */
  to: string;
  /** Project filter (UUID). Empty string = all projects. */
  projectId: string;
};

export const REPORT_TYPES = [
  'project-financial',
  'job-cost',
  'accounts-receivable',
  'invoice-summary',
  'payment-summary',
  'purchase-orders',
  'landed-cost',
  'vat-quarterly',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_LABEL: Record<ReportType, string> = {
  'project-financial': 'Project Financial Report',
  'job-cost': 'Job Cost Report',
  'accounts-receivable': 'Accounts Receivable Report',
  'invoice-summary': 'Invoice Summary Report',
  'payment-summary': 'Payment Summary Report',
  'purchase-orders': 'Purchase Order Summary',
  'landed-cost': 'Landed Cost Summary',
  'vat-quarterly': 'VAT Quarterly Report',
};

export const REPORT_DESCRIPTION: Record<ReportType, string> = {
  'project-financial':
    'Per-project rollup: contract, change orders, invoiced, paid, AR, retainage, cost, GP, margin.',
  'job-cost':
    'Estimated vs. committed vs. actual cost across projects, with category breakdown.',
  'accounts-receivable':
    'Aging buckets per customer with overdue invoices flagged.',
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
};

/**
 * Whether a particular report supports a project filter (some are
 * cross-project by nature — payments, AR — and ignore the filter).
 */
export const REPORT_SUPPORTS_PROJECT_FILTER: Record<ReportType, boolean> = {
  'project-financial': true,
  'job-cost': true,
  'accounts-receivable': false,
  'invoice-summary': true,
  'payment-summary': true,
  'purchase-orders': true,
  'landed-cost': true,
  'vat-quarterly': false,
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
 * non-empty filter params.
 */
export function buildCsvUrl(type: ReportType, filters: ReportFilters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.projectId) params.set('projectId', filters.projectId);
  const qs = params.toString();
  return `/reports/${type}/export.csv${qs ? `?${qs}` : ''}`;
}
