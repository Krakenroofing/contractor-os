// Single source of truth for PDF colours, spacing, and typography.
// Future per-company branding overrides should plug in here.

export const pdfTheme = {
  colors: {
    text: '#0f172a',
    muted: '#64748b',
    subtle: '#94a3b8',
    border: '#e2e8f0',
    rowAlt: '#f8fafc',
    accent: '#0f172a',
    accentText: '#ffffff',
    success: '#047857',
    warning: '#b45309',
  },
  fontSize: {
    xs: 8,
    sm: 9,
    md: 10,
    lg: 12,
    xl: 14,
    title: 18,
  },
  spacing: {
    page: 36,
    section: 14,
    row: 6,
  },
} as const;

export function formatMoneyForPdf(
  value: number,
  currency = 'USD',
  locale = 'en-US',
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${currency} ${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
  }
}

export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
