// Duplicate vendor-invoice check across companies (roadmap P4).
//
// Kraken and TRB each keep their own vendor list, so "the same ABC invoice
// entered in both companies" can't be caught by vendor id. Two bills are
// treated as the same supplier invoice when their invoice numbers match
// (ignoring case, spaces and punctuation) AND either the vendor names match
// (ignoring Inc/LLC/Co/Ltd and punctuation) or the amounts match to the
// cent. Void and deleted bills never count.

import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';

export type DuplicateBillRef = {
  receiptId: string;
  companyId: string;
  companyName: string;
  vendorName: string | null;
  vendorInvoiceNumber: string;
  total: number;
  receiptDate: string;
  status: string;
};

type Row = {
  id: string;
  company_id: string;
  company_name: string;
  vendor_name: string | null;
  vendor_invoice_number: string;
  inv_norm: string;
  total: string;
  receipt_date: string | Date;
  status: string;
};

export function normalizeVendorName(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|co|corp|corporation|company|the)\b/g, ' ')
    .replace(/\s+/g, '');
}

const toRef = (r: Row): DuplicateBillRef => ({
  receiptId: r.id,
  companyId: r.company_id,
  companyName: r.company_name,
  vendorName: r.vendor_name,
  vendorInvoiceNumber: r.vendor_invoice_number,
  total: Number(r.total),
  receiptDate:
    r.receipt_date instanceof Date
      ? r.receipt_date.toISOString().slice(0, 10)
      : String(r.receipt_date).slice(0, 10),
  status: r.status,
});

function sameInvoice(a: Row, b: Row): boolean {
  if (a.inv_norm !== b.inv_norm) return false;
  const va = normalizeVendorName(a.vendor_name);
  const vb = normalizeVendorName(b.vendor_name);
  const sameVendor = va !== '' && va === vb;
  const sameAmount =
    Math.round(Math.abs(Number(a.total)) * 100) ===
    Math.round(Math.abs(Number(b.total)) * 100);
  return sameVendor || sameAmount;
}

async function loadRows(
  companyIds: string[],
  invNorms?: string[],
): Promise<Row[]> {
  if (!isDatabaseConfigured() || companyIds.length === 0) return [];
  const db = getDb()!;
  const ids = sql.join(companyIds.map((id) => sql`${id}::uuid`), sql`, `);
  const normFilter =
    invNorms && invNorms.length > 0
      ? sql`AND lower(regexp_replace(r.vendor_invoice_number, '[^A-Za-z0-9]', '', 'g')) IN (${sql.join(
          invNorms.map((n) => sql`${n}`),
          sql`, `,
        )})`
      : sql``;
  const rows = await db.execute(sql`
    SELECT r.id, r.company_id, c.name AS company_name, v.name AS vendor_name,
           r.vendor_invoice_number,
           lower(regexp_replace(r.vendor_invoice_number, '[^A-Za-z0-9]', '', 'g')) AS inv_norm,
           r.total, r.receipt_date, r.status
      FROM receipts r
      JOIN companies c ON c.id = r.company_id
      LEFT JOIN vendors v ON v.id = r.vendor_id
     WHERE r.company_id IN (${ids})
       AND r.deleted_at IS NULL
       AND r.status <> 'void'
       AND r.vendor_invoice_number IS NOT NULL
       AND lower(regexp_replace(r.vendor_invoice_number, '[^A-Za-z0-9]', '', 'g')) <> ''
       ${normFilter}
  `);
  return rows as unknown as Row[];
}

/** Other bills (any visible company) that look like the same supplier
 *  invoice as `receiptId`. */
export async function findDuplicatesForBill(
  companyIds: string[],
  receiptId: string,
  vendorInvoiceNumber: string | null,
): Promise<DuplicateBillRef[]> {
  const norm = (vendorInvoiceNumber ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!norm) return [];
  const rows = await loadRows(companyIds, [norm]);
  const self = rows.find((r) => r.id === receiptId);
  if (!self) return [];
  return rows.filter((r) => r.id !== receiptId && sameInvoice(self, r)).map(toRef);
}

/** Every group of bills that look like one supplier invoice entered more
 *  than once — within a company or across companies. */
export async function listDuplicateBillGroups(
  companyIds: string[],
): Promise<DuplicateBillRef[][]> {
  const rows = await loadRows(companyIds);
  const byNorm = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = byNorm.get(r.inv_norm) ?? [];
    arr.push(r);
    byNorm.set(r.inv_norm, arr);
  }
  const groups: DuplicateBillRef[][] = [];
  for (const arr of byNorm.values()) {
    if (arr.length < 2) continue;
    // Union bills that pairwise look like the same invoice.
    const seen = new Set<string>();
    for (const a of arr) {
      if (seen.has(a.id)) continue;
      const group = [a];
      seen.add(a.id);
      for (let i = 0; i < group.length; i++) {
        for (const b of arr) {
          if (!seen.has(b.id) && sameInvoice(group[i], b)) {
            group.push(b);
            seen.add(b.id);
          }
        }
      }
      if (group.length > 1) groups.push(group.map(toRef));
    }
  }
  return groups.sort((x, y) => y[0].receiptDate.localeCompare(x[0].receiptDate));
}
