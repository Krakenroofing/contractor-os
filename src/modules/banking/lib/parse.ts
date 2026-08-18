// Bytes → RawSheet. Routes by MIME / extension to the CSV parser or to
// exceljs for XLSX. Returns the same { headers, rows } shape regardless.
//
// We never coerce types here. Every cell is a string in the same shape as
// it appeared in the file, so the mapping layer can re-parse with different
// settings without re-reading the file.

import 'server-only';
import ExcelJS from 'exceljs';
import { parseCsv, sniffDelimiter, type RawSheet } from './csv';

// Per-file row cap. 50k is well above any normal bank statement (a busy
// month is rarely >2k transactions) but small enough that a malformed file
// can't OOM the server. Rows beyond the cap are dropped and surfaced as an
// error count in the caller.
export const MAX_ROWS_PER_FILE = 50_000;

export class StatementParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatementParseError';
  }
}

export type ParseStatementInput = {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
};

export type ParseStatementResult = RawSheet & {
  /** Best-effort detected delimiter for CSV inputs (debug surface). */
  delimiter?: string;
  /** True if rows were truncated at MAX_ROWS_PER_FILE. */
  truncated: boolean;
};

/** True when the bytes start with the zip local-file-header magic
 *  ("PK\x03\x04") every real .xlsx begins with. */
function hasZipMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** Decode as UTF-8 text if the content is plausibly text (no NUL bytes in
 *  the sampled head). Returns null for binary junk. */
function tryDecodeText(bytes: Uint8Array): string | null {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  for (const b of sample) {
    if (b === 0) return null;
  }
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** Cheap CSV sniff: at least one line break and a common delimiter in the
 *  first line — enough to route a renamed CSV into the CSV parser. */
function looksLikeDelimitedText(text: string): boolean {
  const head = text.slice(0, 2000);
  if (!/[\r\n]/.test(head)) return false;
  const firstLine = head.split(/\r?\n/, 1)[0] ?? '';
  return /[,;\t|]/.test(firstLine);
}

function isCsvLike(mime: string, filename: string): boolean {
  const m = mime.toLowerCase();
  if (m === 'text/csv' || m === 'application/csv' || m === 'text/plain') return true;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return true;
  return false;
}

function isXlsxLike(mime: string, filename: string): boolean {
  const m = mime.toLowerCase();
  if (
    m ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    m === 'application/vnd.ms-excel'
  ) {
    return true;
  }
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'xlsx' || ext === 'xls';
}

export async function parseStatementBytes(
  input: ParseStatementInput,
): Promise<ParseStatementResult> {
  if (isCsvLike(input.mimeType, input.filename)) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(input.bytes);
    const delimiter = sniffDelimiter(text);
    const sheet = parseCsv(text, delimiter);
    const truncated = sheet.rows.length > MAX_ROWS_PER_FILE;
    return {
      headers: sheet.headers,
      rows: truncated ? sheet.rows.slice(0, MAX_ROWS_PER_FILE) : sheet.rows,
      delimiter,
      truncated,
    };
  }

  if (isXlsxLike(input.mimeType, input.filename)) {
    // Real .xlsx files are zip archives and start with the PK magic bytes
    // (50 4B 03 04). Renamed CSVs and corrupted downloads don't — and
    // feeding them to exceljs surfaces a raw jszip "Can't find end of
    // central directory" crash. Sniff first: if the bytes are actually
    // delimited text, parse as CSV; otherwise reject with a clear message.
    if (!hasZipMagic(input.bytes)) {
      const asText = tryDecodeText(input.bytes);
      if (asText !== null && looksLikeDelimitedText(asText)) {
        const delimiter = sniffDelimiter(asText);
        const sheet = parseCsv(asText, delimiter);
        const truncated = sheet.rows.length > MAX_ROWS_PER_FILE;
        return {
          headers: sheet.headers,
          rows: truncated ? sheet.rows.slice(0, MAX_ROWS_PER_FILE) : sheet.rows,
          delimiter,
          truncated,
        };
      }
      throw new StatementParseError(
        `${input.filename} isn't a valid Excel file. Upload the .xlsx exported from your bank, or a .csv. (Renaming a file to .xlsx doesn't convert it.)`,
      );
    }

    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs accepts a Uint8Array.buffer for xlsx loading.
      await workbook.xlsx.load(input.bytes.buffer as ArrayBuffer);
    } catch {
      // Second layer: zip magic present but the archive is unreadable
      // (truncated download, partial upload). Never let jszip's error
      // propagate to the user.
      throw new StatementParseError(
        `${input.filename} looks like an Excel file but could not be read — it may be a corrupted or incomplete download. Re-export it from your bank and upload again, or upload a .csv.`,
      );
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new StatementParseError('XLSX file contains no worksheets.');
    }
    const rawRows: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as Array<ExcelJS.CellValue>;
      // exceljs uses 1-based indexing in `values`. Slice off the leading null.
      const arr = (values.length > 0 ? values.slice(1) : []).map(cellToString);
      rawRows.push(arr);
    });
    if (rawRows.length === 0) return { headers: [], rows: [], truncated: false };
    const headers = (rawRows.shift() ?? []).map((h) => (h ?? '').trim());
    const truncated = rawRows.length > MAX_ROWS_PER_FILE;
    const capped = truncated ? rawRows.slice(0, MAX_ROWS_PER_FILE) : rawRows;
    const rows: Record<string, string>[] = capped.map((r) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = (r[i] ?? '').trim();
      }
      return obj;
    });
    return { headers, rows, truncated };
  }

  throw new StatementParseError(
    `Unsupported file type for ${input.filename} (mime=${input.mimeType}).`,
  );
}

/** Coerce any ExcelJS cell value to a stable string. Dates render in ISO
 *  format so the mapping date-format settings still apply consistently. */
function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) {
    // ISO YYYY-MM-DD form — survives the date-format normalizer.
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'object') {
    // Rich text or formula objects.
    const obj = v as { text?: string; result?: unknown; richText?: Array<{ text?: string }> };
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.result === 'string' || typeof obj.result === 'number') {
      return String(obj.result);
    }
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((r) => r.text ?? '').join('');
    }
  }
  return String(v);
}
