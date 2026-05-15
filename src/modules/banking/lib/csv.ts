// Minimal RFC-4180 CSV parser. Zero dependencies, no float drift.
//
// Handles:
//   - quoted fields with embedded commas, quotes (escaped as ""), and newlines
//   - CRLF, LF, CR line endings
//   - BOM at the start of the file
//   - trailing newline
//   - empty trailing fields
//
// Returns { headers, rows } where rows are { columnName: rawString }. Numbers
// and dates are NOT coerced here — that's the mapping layer's job, so the
// raw cell value remains available for `raw_row` and for re-mapping.

export type RawSheet = {
  headers: string[];
  rows: Record<string, string>[];
};

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Parse a single CSV file. Caller already decoded bytes → UTF-8 string. */
export function parseCsv(input: string, delimiter = ','): RawSheet {
  const src = stripBom(input);
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let i = 0;
  let inQuotes = false;
  const len = src.length;

  while (i < len) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // CR or CRLF — peek next
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Flush trailing field/row if file didn't end with newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return { headers: [], rows: [] };
  // Drop a final empty row (file ended with a newline).
  if (
    rows.length > 0 &&
    rows[rows.length - 1].length === 1 &&
    rows[rows.length - 1][0] === ''
  ) {
    rows.pop();
  }

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (const r of rows) {
    if (r.length === 1 && r[0].trim() === '') continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (r[c] ?? '').trim();
    }
    out.push(obj);
  }
  return { headers, rows: out };
}

/** Sniff a likely delimiter from the first non-empty line. Tries the four
 *  most common: comma, semicolon, tab, pipe. Picks the highest count. */
export function sniffDelimiter(input: string): string {
  const src = stripBom(input);
  const firstLineEnd = src.search(/[\r\n]/);
  const line = firstLineEnd >= 0 ? src.slice(0, firstLineEnd) : src;
  const candidates: Array<{ d: string; n: number }> = [
    { d: ',', n: 0 },
    { d: ';', n: 0 },
    { d: '\t', n: 0 },
    { d: '|', n: 0 },
  ];
  // Naive count — ignores quoting on the first line, which is fine for
  // delimiter detection in 99% of bank exports.
  for (const c of candidates) {
    c.n = (line.match(new RegExp(`\\${c.d}`, 'g')) ?? []).length;
  }
  candidates.sort((a, b) => b.n - a.n);
  return candidates[0].n > 0 ? candidates[0].d : ',';
}
