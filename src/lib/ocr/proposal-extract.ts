// Proposal extraction: Document AI OCR for the raw text + money/date
// entities, then heading-driven parsing of the prose sections.
//
// Proposals (typically authored outside the app and uploaded as PDFs) are
// prose documents — "Scope of Work", "Inclusions", "Exclusions", payment
// terms, warranty — not receipt-style line-item tables, so the entity
// extraction that powers receipts/POs only contributes the total and the
// date here. The section split works off the OCR'd text: a short line that
// starts with a known heading opens a section, the next heading closes it.
// Everything lands in an editable review form, so a missed section costs a
// copy-paste, never data.

import 'server-only';
import {
  extractReceipt,
  isOcrConfigured,
  OcrNotConfiguredError,
} from './document-ai';

export { isOcrConfigured, OcrNotConfiguredError };

export type ExtractedProposal = {
  number: string | null;
  proposalDate: string | null; // YYYY-MM-DD
  total: number | null;
  scopeOfWork: string | null;
  inclusions: string | null;
  exclusions: string | null;
  paymentSchedule: string | null;
  warrantyNotes: string | null;
  termsAndConditions: string | null;
};

type SectionKey =
  | 'scopeOfWork'
  | 'inclusions'
  | 'exclusions'
  | 'paymentSchedule'
  | 'warrantyNotes'
  | 'termsAndConditions'
  | 'ignored';

/** Ordered: first pattern that matches the start of a line wins. Boundary
 *  headings ("Pricing", "Notes", "Acceptance"…) map to `ignored` so they
 *  still terminate the previous section without capturing into it. */
const HEADING_PATTERNS: Array<[RegExp, SectionKey]> = [
  [/^scope of work\b/i, 'scopeOfWork'],
  [/^scope\b/i, 'scopeOfWork'],
  [/^inclusions?\b/i, 'inclusions'],
  [/^what'?s included\b/i, 'inclusions'],
  [/^exclusions?\b/i, 'exclusions'],
  [/^not included\b/i, 'exclusions'],
  [/^payment (schedule|terms)\b/i, 'paymentSchedule'],
  [/^schedule of (payments?|values)\b/i, 'paymentSchedule'],
  [/^draw schedule\b/i, 'paymentSchedule'],
  [/^warrant(y|ies)\b/i, 'warrantyNotes'],
  [/^terms\s*(and|&)\s*conditions\b/i, 'termsAndConditions'],
  [/^general conditions\b/i, 'termsAndConditions'],
  [/^terms\b/i, 'termsAndConditions'],
  [/^pricing\b/i, 'ignored'],
  [/^investment\b/i, 'ignored'],
  [/^notes?\b/i, 'ignored'],
  [/^acceptance\b/i, 'ignored'],
  [/^signature/i, 'ignored'],
  [/^authoriz/i, 'ignored'],
];

/** A heading is a SHORT line — real content lines that happen to start
 *  with "scope..." mid-paragraph stay content. */
const MAX_HEADING_LENGTH = 80;

function matchHeading(line: string): SectionKey | null {
  const t = line.trim();
  if (t === '' || t.length > MAX_HEADING_LENGTH) return null;
  for (const [re, key] of HEADING_PATTERNS) {
    if (re.test(t)) return key;
  }
  return null;
}

export function parseProposalSections(
  text: string,
): Partial<Record<Exclude<SectionKey, 'ignored'>, string>> {
  const out = new Map<SectionKey, string[]>();
  let current: SectionKey | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const heading = matchHeading(rawLine);
    if (heading) {
      current = heading;
      if (heading !== 'ignored' && !out.has(heading)) out.set(heading, []);
      continue;
    }
    if (current && current !== 'ignored') out.get(current)!.push(rawLine);
  }
  const result: Partial<Record<Exclude<SectionKey, 'ignored'>, string>> = {};
  for (const [key, lines] of out) {
    if (key === 'ignored') continue;
    const body = lines.join('\n').trim();
    if (body !== '') result[key] = body;
  }
  return result;
}

/** "Proposal #P-104", "Quote No: 2026-14", "Ref: KR-Lodge-Rev02"… */
export function parseProposalNumber(text: string): string | null {
  const m =
    /\b(?:proposal|quote|quotation|ref(?:erence)?)\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9/-]*)/i.exec(
      text,
    );
  return m ? m[1] : null;
}

/** Largest $-amount in the text — fallback when the receipt processor
 *  doesn't surface a total entity for a prose document. */
export function parseLargestAmount(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && (best === null || n > best)) best = n;
  }
  return best;
}

export async function extractProposalFromPdf(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<ExtractedProposal> {
  const raw = await extractReceipt(input);
  const text = raw.rawText ?? '';
  const sections = parseProposalSections(text);
  return {
    number: parseProposalNumber(text),
    proposalDate: raw.receiptDate ?? null,
    total: raw.total ?? parseLargestAmount(text),
    scopeOfWork: sections.scopeOfWork ?? null,
    inclusions: sections.inclusions ?? null,
    exclusions: sections.exclusions ?? null,
    paymentSchedule: sections.paymentSchedule ?? null,
    warrantyNotes: sections.warrantyNotes ?? null,
    termsAndConditions: sections.termsAndConditions ?? null,
  };
}
