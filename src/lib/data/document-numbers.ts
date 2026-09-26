// System-assigned document numbers (roadmap Priority 1). The numbers are
// assigned by database triggers from `document_sequences` inside the
// insert's own transaction (migration 2026-09-26b_document_numbering.sql);
// this module only peeks at the next number for display, logs the events
// that explain a missing / out-of-range number, and builds the gap report.

import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';

export type DocNumberEvent = 'deleted_draft' | 'external';

/** The number the next invoice will get (display only — the trigger is
 *  authoritative). Mirrors the trigger's skip-taken rule. */
export async function peekNextInvoiceNumber(companyId: string): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  const db = getDb()!;
  const rows = (await db.execute(sql`
    SELECT next_value FROM document_sequences
    WHERE company_id = ${companyId} AND doc_type = 'invoice'
  `)) as unknown as Array<{ next_value: string | number }>;
  let next = rows[0] ? Number(rows[0].next_value) : 1001;
  const taken = new Set(
    (
      (await db.execute(sql`
        SELECT number FROM invoices
        WHERE company_id = ${companyId} AND number ~ '^[0-9]+$'
          AND number::bigint >= ${next} AND number::bigint < ${next + 500}
      `)) as unknown as Array<{ number: string }>
    ).map((r) => r.number),
  );
  while (taken.has(String(next))) next++;
  return String(next);
}

export async function logDocumentNumber(input: {
  companyId: string;
  docType: string;
  number: string;
  event: DocNumberEvent;
  documentId?: string | null;
  userId?: string | null;
  userName?: string | null;
  note?: string | null;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  await db.execute(sql`
    INSERT INTO document_number_log
      (company_id, doc_type, number, event, document_id, user_id, user_name, note)
    VALUES (${input.companyId}, ${input.docType}, ${input.number}, ${input.event},
            ${input.documentId ?? null}, ${input.userId ?? null},
            ${input.userName ?? null}, ${input.note ?? null})
  `);
}

export type SequenceAudit = {
  docType: string;
  label: string;
  startValue: number;
  nextValue: number;
  /** Numbers in [start, next) that exist as documents. */
  issued: number;
  voided: number;
  /** Missing numbers explained by a logged deleted draft. */
  deletedDrafts: Array<{ number: string; by: string | null; at: Date }>;
  /** Missing numbers with no explanation. */
  unexplained: string[];
  /** Historical numbers entered by hand (external range). */
  external: Array<{ number: string; by: string | null; at: Date }>;
};

function fmtNumber(docType: string, n: number): string {
  if (docType.startsWith('credit_memo:')) {
    return `CM-${docType.slice('credit_memo:'.length)}-${String(n).padStart(3, '0')}`;
  }
  return String(n);
}

export async function auditDocumentSequences(companyId: string): Promise<SequenceAudit[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const seqs = (await db.execute(sql`
    SELECT doc_type, start_value, next_value FROM document_sequences
    WHERE company_id = ${companyId} ORDER BY doc_type
  `)) as unknown as Array<{ doc_type: string; start_value: string; next_value: string }>;
  const log = (await db.execute(sql`
    SELECT doc_type, number, event, user_name, created_at FROM document_number_log
    WHERE company_id = ${companyId} ORDER BY created_at
  `)) as unknown as Array<{
    doc_type: string;
    number: string;
    event: DocNumberEvent;
    user_name: string | null;
    created_at: Date;
  }>;
  const invoiceRows = (await db.execute(sql`
    SELECT number, status::text AS status FROM invoices WHERE company_id = ${companyId}
  `)) as unknown as Array<{ number: string; status: string }>;
  const cmRows = (await db.execute(sql`
    SELECT number, status::text AS status FROM credit_memos WHERE company_id = ${companyId}
  `)) as unknown as Array<{ number: string; status: string }>;

  const out: SequenceAudit[] = [];
  for (const s of seqs) {
    const start = Number(s.start_value);
    const next = Number(s.next_value);
    const isCm = s.doc_type.startsWith('credit_memo:');
    const docs = isCm ? cmRows : invoiceRows;
    const statusByNumber = new Map<string, string[]>();
    for (const d of docs) {
      const arr = statusByNumber.get(d.number) ?? [];
      arr.push(d.status);
      statusByNumber.set(d.number, arr);
    }
    const myLog = log.filter((l) => l.doc_type === s.doc_type);
    const deletedByNumber = new Map(
      myLog.filter((l) => l.event === 'deleted_draft').map((l) => [l.number, l]),
    );
    let issued = 0;
    let voided = 0;
    const deletedDrafts: SequenceAudit['deletedDrafts'] = [];
    const unexplained: string[] = [];
    for (let n = start; n < next; n++) {
      const num = fmtNumber(s.doc_type, n);
      const st = statusByNumber.get(num);
      if (st && st.length > 0) {
        issued++;
        if (st.every((x) => x === 'void')) voided++;
      } else if (deletedByNumber.has(num)) {
        const l = deletedByNumber.get(num)!;
        deletedDrafts.push({ number: num, by: l.user_name, at: l.created_at });
      } else {
        unexplained.push(num);
      }
    }
    out.push({
      docType: s.doc_type,
      label: isCm
        ? `Credit memos ${s.doc_type.slice('credit_memo:'.length)}`
        : 'Invoices',
      startValue: start,
      nextValue: next,
      issued,
      voided,
      deletedDrafts,
      unexplained,
      external: myLog
        .filter((l) => l.event === 'external')
        .map((l) => ({ number: l.number, by: l.user_name, at: l.created_at })),
    });
  }
  return out;
}
