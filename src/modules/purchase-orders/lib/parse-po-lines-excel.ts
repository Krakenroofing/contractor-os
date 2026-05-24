// Parser for a generic PO line-item Excel/CSV file. Looks for a header row
// with description / qty / unit / cost columns under tolerant aliases so
// vendors with slightly different quote templates still work.
//
// Output is normalized rows ready for matching against the inventory
// catalog and insertion into the PO form. SKU is captured when present so
// the matcher can prefer exact SKU hits over name-based fuzzy scoring.

import * as XLSX from 'xlsx';

export type ParsedPoLineRow = {
  description: string;
  sku: string | null;
  unit: string | null;
  quantity: string;
  unitCost: string;
};

export type ParseResult = {
  rows: ParsedPoLineRow[];
  warnings: string[];
};

const HEADER_ALIASES: Record<string, string[]> = {
  description: [
    'description',
    'item',
    'item description',
    'product',
    'product/service',
    'name',
    'material',
  ],
  sku: ['sku', 'part #', 'part number', 'part no', 'item #', 'item no', 'code'],
  unit: ['unit', 'u/m', 'uom', 'units'],
  quantity: ['qty', 'quantity', 'qty ordered', 'order qty'],
  unitCost: [
    'unit cost',
    'cost',
    'price',
    'unit price',
    'rate',
    'each',
    'unit $',
  ],
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
  // Strip currency symbols and thousands separators before parsing.
  const cleaned = s.replace(/[$,]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n.toString() : '0';
}

export function parsePoLinesBuffer(buf: ArrayBuffer): ParseResult {
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

  // Many vendor quotes have a few title rows above the actual header. Scan
  // the first 10 rows for one that looks like a header (matches at least
  // the description column).
  let headerIdx = -1;
  let map: Record<string, number> = {};
  const scanLimit = Math.min(10, raw.length);
  for (let i = 0; i < scanLimit; i++) {
    const candidate = raw[i] as unknown[];
    if (!Array.isArray(candidate)) continue;
    const m = buildHeaderMap(candidate);
    if (m.description !== undefined) {
      headerIdx = i;
      map = m;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      rows: [],
      warnings: [
        'Could not find a header row with a Description / Item column. Expected something like Description, Qty, Unit, Cost across the first row of data.',
      ],
    };
  }

  const warnings: string[] = [];
  if (map.quantity === undefined) {
    warnings.push('No Qty column detected — quantities will default to 1.');
  }
  if (map.unitCost === undefined) {
    warnings.push('No Unit Cost / Price column detected — costs will default to 0.');
  }

  const out: ParsedPoLineRow[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    if (!Array.isArray(row)) continue;
    const desc = cellString(row, map.description);
    if (desc === '') continue;
    // Skip subtotal/total rows by description.
    const lower = desc.toLowerCase();
    if (
      lower === 'subtotal' ||
      lower === 'total' ||
      lower === 'tax' ||
      lower === 'shipping' ||
      lower === 'freight'
    ) {
      continue;
    }
    const qty = map.quantity !== undefined ? cellNumber(row, map.quantity) : '1';
    const cost = map.unitCost !== undefined ? cellNumber(row, map.unitCost) : '0';
    out.push({
      description: desc,
      sku: cellString(row, map.sku) || null,
      unit: cellString(row, map.unit) || null,
      quantity: qty,
      unitCost: cost,
    });
  }

  if (out.length === 0) {
    warnings.push('No line rows were found below the header.');
  }

  return { rows: out, warnings };
}
