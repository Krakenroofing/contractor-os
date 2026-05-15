// Deterministic duplicate-detection hash for imported bank transactions.
//
// The hash is built from a stable set of fields and stored on each
// imported_transactions row. A UNIQUE(company_id, bank_account_id,
// dedupe_hash) index + ON CONFLICT DO NOTHING guarantees that re-importing
// the same statement file is a no-op.
//
// Fields used:
//   - bank_account_id    : same row in a different bank is not a duplicate
//   - effective_date     : posted_date if present, else transaction_date
//   - amount_cents       : signed integer cents — no float drift
//   - normalized_desc    : lowercased, collapsed whitespace, punctuation stripped
//   - reference          : whatever the bank gave us (check #, txn id), or ''
//
// We deliberately omit memo/payee/notes because those are often the user-
// editable enrichment columns and would defeat duplicate detection if the
// operator added a note before re-running an import.

import 'server-only';
import { createHash } from 'node:crypto';

export type DedupeHashInput = {
  bankAccountId: string;
  effectiveDate: string; // ISO 'YYYY-MM-DD'
  amountCents: number; // signed integer cents
  description: string;
  reference: string | null;
};

/** Collapses whitespace, lowercases, strips punctuation. Stable across
 * common bank reformatting (extra spaces, trailing dots). */
export function normalizeDescription(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convert a money number to integer cents safely. We assume the caller
 *  already parsed the source string to a `number` rounded to 2 decimals
 *  via parseMoney / round2; here we just multiply and round again as a
 *  belt-and-braces measure. */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  // Math.round handles the .5 edge with banker's rounding off. We add a
  // tiny epsilon to keep 1.005 → 101 instead of 100 (mirrors the
  // EPSILON-safe round2 in @/lib/money).
  const sign = amount < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(amount) * 100 + Number.EPSILON);
}

export function buildDedupeHash(input: DedupeHashInput): string {
  const parts = [
    input.bankAccountId,
    input.effectiveDate,
    String(input.amountCents),
    normalizeDescription(input.description),
    input.reference ?? '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
