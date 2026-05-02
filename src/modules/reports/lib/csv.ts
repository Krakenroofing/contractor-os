// Tiny CSV serializer. RFC 4180-ish: fields containing comma, double quote,
// or newline get wrapped in double quotes with embedded quotes doubled.

export type CsvCell = string | number | boolean | null | undefined | Date;

function quote(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  let str: string;
  if (cell instanceof Date) {
    str = cell.toISOString();
  } else if (typeof cell === 'number') {
    // Avoid scientific notation for big amounts.
    str = Number.isFinite(cell) ? String(cell) : '';
  } else if (typeof cell === 'boolean') {
    str = cell ? 'true' : 'false';
  } else {
    str = String(cell);
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(rows: CsvCell[][]): string {
  return rows.map((r) => r.map(quote).join(',')).join('\r\n');
}

/**
 * Build a Response that streams CSV. Ensures the browser triggers a download
 * with the right filename + UTF-8 BOM (so Excel handles non-ASCII correctly).
 */
export function csvResponse(filename: string, csv: string): Response {
  const body = '﻿' + csv;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Convenience: build a filename like
 *   project-financial-2026-01-01-to-2026-05-31.csv
 * Falls back to a safe default if no range provided.
 */
export function csvFilename(
  reportType: string,
  from: string,
  to: string,
): string {
  const stamp =
    from && to
      ? `${from}-to-${to}`
      : from
        ? `from-${from}`
        : to
          ? `to-${to}`
          : new Date().toISOString().slice(0, 10);
  return `${reportType}-${stamp}.csv`;
}
