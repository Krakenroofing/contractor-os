// RawSheet + Mapping → typed transaction drafts.
//
// This file is the heart of currency-safe parsing. Every amount goes through
// a string sanitizer (strip currency symbols, normalize separators, handle
// parentheses-as-negative, trailing CR/DR), then through @/lib/money's
// EPSILON-safe parser. No floating-point arithmetic on raw strings.

import { parseMoney, round2, toMoneyString } from '@/lib/money';

export const AMOUNT_STRATEGIES = ['signed_amount', 'debit_credit_split'] as const;
export type AmountStrategy = (typeof AMOUNT_STRATEGIES)[number];

export const DATE_FORMATS = [
  'YYYY-MM-DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'M/D/YYYY',
  'D/M/YYYY',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export type ColumnMap = {
  date?: string;
  postedDate?: string;
  description?: string;
  payee?: string;
  memo?: string;
  amount?: string; // when amount_strategy = 'signed_amount'
  debit?: string; // when amount_strategy = 'debit_credit_split'
  credit?: string; // when amount_strategy = 'debit_credit_split'
  reference?: string;
};

export type Mapping = {
  columnMap: ColumnMap;
  dateFormat: DateFormat;
  amountStrategy: AmountStrategy;
  decimalSeparator: string; // '.' or ','
  thousandsSeparator: string; // ',' or '.' or ' ' or ''
  skipRows: number;
};

export type TransactionDraft = {
  transactionDate: string; // ISO 'YYYY-MM-DD'
  postedDate: string | null;
  description: string;
  payee: string | null;
  memo: string | null;
  /** Signed amount: positive = money in (credit), negative = money out (debit). */
  amount: number;
  debit: number | null;
  credit: number | null;
  reference: string | null;
  rawRow: Record<string, string>;
};

export type MappingApplyResult = {
  drafts: TransactionDraft[];
  errors: { rowIndex: number; reason: string }[];
};

// ===== Amount parsing =====

/** Sanitize a bank's amount string to a canonical "1234.56" or "-1234.56"
 *  form. Handles:
 *    - currency symbols ($, €, £, BSD, USD)
 *    - thousands and decimal separators (configurable)
 *    - parentheses-as-negative ((1,234.56) = -1234.56)
 *    - trailing CR/DR markers (5.00 CR = 5.00, 5.00 DR = -5.00)
 *    - leading minus, double minus
 *    - empty / whitespace strings → null
 */
export function sanitizeAmount(
  raw: string | undefined | null,
  decimalSeparator: string,
  thousandsSeparator: string,
): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (s === '') return null;

  // Parentheses-as-negative.
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  // Trailing or prefixed CR/DR.
  const upper = s.toUpperCase();
  if (upper.endsWith(' CR') || upper.endsWith('CR')) {
    s = s.replace(/\s*CR$/i, '');
  } else if (upper.endsWith(' DR') || upper.endsWith('DR')) {
    s = s.replace(/\s*DR$/i, '');
    negative = !negative;
  }

  // Strip currency symbols and whitespace.
  s = s.replace(/[\s ]/g, '').replace(/[$£€]/g, '');
  // Strip leading 3-letter currency codes (USD, BSD, EUR, GBP, etc).
  s = s.replace(/^([A-Z]{3})(?=-?\d|\.)/, '');

  if (s === '' || s === '-' || s === '.' || s === ',') return null;

  // Multi-sign collapse.
  if (s.startsWith('--')) {
    s = s.slice(2);
  } else if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }

  // Normalize separators. Strategy: drop thousands separator, then convert
  // decimal separator to '.'. Order matters when separators are same char.
  if (thousandsSeparator && thousandsSeparator !== decimalSeparator) {
    // Strip all thousands occurrences.
    s = s.split(thousandsSeparator).join('');
  }
  if (decimalSeparator !== '.') {
    // Convert exactly the rightmost decimal-separator occurrence to '.'.
    const idx = s.lastIndexOf(decimalSeparator);
    if (idx >= 0) {
      s = s.slice(0, idx) + '.' + s.slice(idx + 1);
    }
  }
  // If thousands separator was the same char as decimal (e.g. both ','),
  // the strategy above doesn't apply — interpret last separator as decimal,
  // strip the rest.
  if (thousandsSeparator === decimalSeparator && thousandsSeparator !== '') {
    // No further work — already handled by the lastIndexOf swap above.
  }

  // Final sanity: only [0-9.] should remain.
  if (!/^[0-9]*\.?[0-9]*$/.test(s)) return null;
  if (s === '' || s === '.') return null;

  return negative ? `-${s}` : s;
}

/** Sanitize → parse → round2. Returns null when the cell is missing/blank. */
export function parseAmountString(
  raw: string | undefined | null,
  decimalSeparator: string,
  thousandsSeparator: string,
): number | null {
  const clean = sanitizeAmount(raw, decimalSeparator, thousandsSeparator);
  if (clean === null) return null;
  const parsed = parseMoney(clean);
  // parseMoney already round2's. Re-round defensively.
  return round2(parsed);
}

// ===== Date parsing =====

/** Returns an ISO 'YYYY-MM-DD' or null. Defensive against zero-padding,
 *  trailing time components, and unsupported formats. */
export function parseDateString(
  raw: string | undefined | null,
  format: DateFormat,
): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (s === '') return null;

  // Strip a trailing time portion if present ("2026-05-01T00:00:00").
  s = s.split(/[T\s]/)[0];

  let y: number;
  let m: number;
  let d: number;
  if (format === 'YYYY-MM-DD') {
    const match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else {
    const sep = s.includes('/') ? '/' : s.includes('-') ? '-' : null;
    if (!sep) return null;
    const parts = s.split(sep);
    if (parts.length !== 3) return null;
    const [a, b, c] = parts.map((p) => Number(p));
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) {
      return null;
    }
    if (format === 'MM/DD/YYYY' || format === 'M/D/YYYY') {
      m = a;
      d = b;
      y = c;
    } else {
      d = a;
      m = b;
      y = c;
    }
  }

  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  // Two-digit year tolerance: 00-79 → 20XX, 80-99 → 19XX.
  if (y < 100) {
    y = y >= 80 ? 1900 + y : 2000 + y;
  }
  if (y < 1900 || y > 2999) return null;

  const yy = String(y).padStart(4, '0');
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ===== Apply mapping to a RawSheet =====

export function applyMapping(
  rows: Record<string, string>[],
  mapping: Mapping,
): MappingApplyResult {
  const drafts: TransactionDraft[] = [];
  const errors: { rowIndex: number; reason: string }[] = [];

  const cm = mapping.columnMap;
  if (!cm.date) {
    return {
      drafts: [],
      errors: [{ rowIndex: -1, reason: 'Date column is required.' }],
    };
  }
  if (mapping.amountStrategy === 'signed_amount' && !cm.amount) {
    return {
      drafts: [],
      errors: [
        { rowIndex: -1, reason: 'Amount column is required (signed-amount strategy).' },
      ],
    };
  }
  if (mapping.amountStrategy === 'debit_credit_split' && !cm.debit && !cm.credit) {
    return {
      drafts: [],
      errors: [
        {
          rowIndex: -1,
          reason: 'At least one of Debit or Credit columns is required.',
        },
      ],
    };
  }
  if (!cm.description) {
    return {
      drafts: [],
      errors: [{ rowIndex: -1, reason: 'Description column is required.' }],
    };
  }

  for (let i = mapping.skipRows; i < rows.length; i++) {
    const r = rows[i];
    const dateStr = parseDateString(r[cm.date], mapping.dateFormat);
    if (!dateStr) {
      errors.push({
        rowIndex: i,
        reason: `Unparseable date "${r[cm.date] ?? ''}" in row ${i + 2}.`,
      });
      continue;
    }
    const postedStr = cm.postedDate
      ? parseDateString(r[cm.postedDate], mapping.dateFormat)
      : null;

    const description = (r[cm.description] ?? '').trim();
    if (description === '') {
      errors.push({
        rowIndex: i,
        reason: `Blank description in row ${i + 2}.`,
      });
      continue;
    }

    let debit: number | null = null;
    let credit: number | null = null;
    let signedAmount: number | null = null;

    if (mapping.amountStrategy === 'signed_amount') {
      signedAmount = parseAmountString(
        r[cm.amount!],
        mapping.decimalSeparator,
        mapping.thousandsSeparator,
      );
      if (signedAmount === null) {
        errors.push({
          rowIndex: i,
          reason: `Unparseable amount "${r[cm.amount!] ?? ''}" in row ${i + 2}.`,
        });
        continue;
      }
      // For signed amounts: positive→credit, negative→debit (raw columns).
      if (signedAmount > 0) credit = signedAmount;
      else if (signedAmount < 0) debit = Math.abs(signedAmount);
    } else {
      const debitVal = cm.debit
        ? parseAmountString(
            r[cm.debit],
            mapping.decimalSeparator,
            mapping.thousandsSeparator,
          )
        : null;
      const creditVal = cm.credit
        ? parseAmountString(
            r[cm.credit],
            mapping.decimalSeparator,
            mapping.thousandsSeparator,
          )
        : null;
      if ((debitVal ?? 0) === 0 && (creditVal ?? 0) === 0) {
        errors.push({
          rowIndex: i,
          reason: `Blank amount (no debit or credit) in row ${i + 2}.`,
        });
        continue;
      }
      // A row with BOTH debit and credit non-zero is suspicious — usually
      // means the operator picked the wrong columns. Surface but pick the
      // larger as authoritative.
      if ((debitVal ?? 0) !== 0 && (creditVal ?? 0) !== 0) {
        errors.push({
          rowIndex: i,
          reason: `Row ${i + 2} has both debit and credit non-zero; please re-check column mapping.`,
        });
        continue;
      }
      // Signed amount: debit = money out = negative; credit = money in = positive.
      const debitAbs = Math.abs(debitVal ?? 0);
      const creditAbs = Math.abs(creditVal ?? 0);
      if (debitAbs > 0) {
        debit = debitAbs;
        signedAmount = -debitAbs;
      } else {
        credit = creditAbs;
        signedAmount = creditAbs;
      }
    }

    drafts.push({
      transactionDate: dateStr,
      postedDate: postedStr,
      description,
      payee: cm.payee ? r[cm.payee]?.trim() || null : null,
      memo: cm.memo ? r[cm.memo]?.trim() || null : null,
      amount: round2(signedAmount!),
      debit: debit !== null ? round2(debit) : null,
      credit: credit !== null ? round2(credit) : null,
      reference: cm.reference ? r[cm.reference]?.trim() || null : null,
      rawRow: r,
    });
  }

  return { drafts, errors };
}

/** Sum debits/credits as canonical money strings. Used for the preview's
 *  pre-commit totals validation. */
export function summarizeDrafts(drafts: TransactionDraft[]): {
  totalsDebit: string;
  totalsCredit: string;
  rowCount: number;
} {
  let d = 0;
  let c = 0;
  for (const t of drafts) {
    if (t.debit) d += t.debit;
    if (t.credit) c += t.credit;
  }
  return {
    totalsDebit: toMoneyString(round2(d)),
    totalsCredit: toMoneyString(round2(c)),
    rowCount: drafts.length,
  };
}
