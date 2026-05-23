// Parser for the QuickBooks Online "Product/Service List" export.
//
// QBO exports the file as .xls (real BIFF/OLE2, not HTML/SYLK), with a
// single sheet whose header row defines a fixed set of columns. We
// snake-tolerate the header names so future QB cosmetic renames don't
// break us silently.
//
// Output is a normalized row[] that the importer action persists.

import * as XLSX from 'xlsx';

export type ParsedQbProductRow = {
  name: string;
  category: string | null;
  sku: string | null;
  unit: string | null;
  defaultCost: string;
  isTaxable: boolean;
  qbGlAccountText: string | null;
};

export type ParseResult = {
  rows: ParsedQbProductRow[];
  warnings: string[];
};

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['product/service name', 'product / service name', 'name'],
  sku: ['sku'],
  type: ['type'],
  taxable: ['taxable'],
  purchase_cost: ['purchase cost', 'cost'],
  expense_account: ['expense account', 'cogs account'],
  // Sales-side fields. Read for completeness; not currently persisted.
  sales_price: ['sales price / rate', 'sales price/rate', 'price'],
  // Unit isn't in QB's standard export; left here so a manual column add works.
  unit: ['unit', 'u/m', 'uom'],
};

function normalizeHeader(h: unknown): string {
  if (h === null || h === undefined) return '';
  return String(h).trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildHeaderMap(headerRow: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  const norm = headerRow.map(normalizeHeader);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = norm.findIndex((h) => aliases.includes(h));
    if (idx !== -1) map[key] = idx;
  }
  return map;
}

function cellString(row: unknown[], idx: number | undefined): string {
  if (idx === undefined) return '';
  const v = row[idx];
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function cellNumber(row: unknown[], idx: number | undefined): string {
  const s = cellString(row, idx);
  if (s === '') return '0';
  const n = Number(s);
  return Number.isFinite(n) ? n.toString() : '0';
}

// QBO names items as "Category:Name" (e.g. "02 Site Work:Alum Pop Rivets
// White"). Split on the FIRST colon so nested names with stray colons
// in the leaf survive.
function splitCategory(raw: string): { category: string | null; name: string } {
  const idx = raw.indexOf(':');
  if (idx === -1) return { category: null, name: raw };
  return {
    category: raw.slice(0, idx).trim() || null,
    name: raw.slice(idx + 1).trim(),
  };
}

export function parseQbProductListBuffer(buf: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { rows: [], warnings: ['File has no sheets.'] };
  }
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
  });
  if (raw.length === 0) {
    return { rows: [], warnings: ['Sheet is empty.'] };
  }
  const headerRow = raw[0] as unknown[];
  const map = buildHeaderMap(headerRow);
  const warnings: string[] = [];
  if (map.name === undefined) {
    warnings.push(
      'Missing "Product/Service Name" column. Make sure the file is a QuickBooks Online Product/Service export.',
    );
    return { rows: [], warnings };
  }

  const out: ParsedQbProductRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    if (!Array.isArray(row)) continue;
    const rawName = cellString(row, map.name);
    if (rawName === '') continue;
    // Some QB exports trail a footer warning row; skip rows whose Type
    // column is non-empty and not "Inventory" / "Non-inventory" / "Service".
    const type = cellString(row, map.type).toLowerCase();
    if (type !== '' && !['inventory', 'non-inventory', 'service'].includes(type)) {
      continue;
    }

    const { category, name } = splitCategory(rawName);
    out.push({
      name,
      category,
      sku: cellString(row, map.sku) || null,
      unit: cellString(row, map.unit) || null,
      defaultCost: cellNumber(row, map.purchase_cost),
      isTaxable: cellString(row, map.taxable).toLowerCase() === 'yes',
      qbGlAccountText: cellString(row, map.expense_account) || null,
    });
  }

  if (out.length === 0) {
    warnings.push('No product rows were found in the file.');
  }

  return { rows: out, warnings };
}
