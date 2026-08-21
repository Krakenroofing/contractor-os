import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

// Generic report → Excel endpoint. The client scrapes the rendered report
// tables (headers + rows, numbers already parsed) and POSTs them here; we
// build a real .xlsx so ANY report or drill-down exports without bespoke
// per-report wiring. No data access happens here — the payload is what the
// user already sees on screen — but exports are still auth-gated.

type Cell = string | number | { v: number; cur?: boolean };

type ExportTable = {
  caption?: string;
  headers: string[];
  rows: Cell[][];
};

type ExportPayload = {
  title: string;
  subtitle?: string;
  tables: ExportTable[];
};

const CURRENCY_FORMAT = '"$"#,##0.00;[Red]("$"#,##0.00)';
const MAX_TABLES = 40;
const MAX_ROWS = 20000;

function sanitize(payload: unknown): ExportPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.title !== 'string' || !Array.isArray(p.tables)) return null;
  const tables: ExportTable[] = [];
  let rowBudget = MAX_ROWS;
  for (const t of p.tables.slice(0, MAX_TABLES)) {
    if (typeof t !== 'object' || t === null) continue;
    const tt = t as Record<string, unknown>;
    if (!Array.isArray(tt.headers) || !Array.isArray(tt.rows)) continue;
    const headers = tt.headers
      .filter((h): h is string => typeof h === 'string')
      .map((h) => h.slice(0, 200));
    const rows: Cell[][] = [];
    for (const r of tt.rows) {
      if (rowBudget <= 0) break;
      if (!Array.isArray(r)) continue;
      rows.push(
        r.map((c): Cell => {
          if (typeof c === 'number' && Number.isFinite(c)) return c;
          if (
            typeof c === 'object' &&
            c !== null &&
            typeof (c as { v?: unknown }).v === 'number' &&
            Number.isFinite((c as { v: number }).v)
          ) {
            return { v: (c as { v: number }).v, cur: true };
          }
          return String(c ?? '').slice(0, 500);
        }),
      );
      rowBudget--;
    }
    tables.push({
      caption:
        typeof tt.caption === 'string' ? tt.caption.slice(0, 200) : undefined,
      headers,
      rows,
    });
  }
  return {
    title: p.title.slice(0, 200),
    subtitle: typeof p.subtitle === 'string' ? p.subtitle.slice(0, 300) : undefined,
    tables,
  };
}

export async function POST(request: Request) {
  await requireAuth();

  let payload: ExportPayload | null = null;
  try {
    payload = sanitize(await request.json());
  } catch {
    payload = null;
  }
  if (!payload || payload.tables.length === 0) {
    return NextResponse.json(
      { error: 'Nothing to export — no tables found on the page.' },
      { status: 400 },
    );
  }

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet('Report', {
    properties: { defaultColWidth: 14 },
  });

  let rowIdx = 1;
  const title = ws.getCell(rowIdx, 1);
  title.value = payload.title;
  title.font = { size: 15, bold: true };
  rowIdx++;
  if (payload.subtitle) {
    const sub = ws.getCell(rowIdx, 1);
    sub.value = payload.subtitle;
    sub.font = { size: 10, color: { argb: 'FF64748B' } };
    rowIdx++;
  }
  rowIdx++;

  const colWidths: number[] = [];
  const bump = (col: number, len: number) => {
    colWidths[col] = Math.min(48, Math.max(colWidths[col] ?? 10, len + 2));
  };

  for (const table of payload.tables) {
    if (table.caption) {
      const cap = ws.getCell(rowIdx, 1);
      cap.value = table.caption;
      cap.font = { size: 12, bold: true };
      rowIdx++;
    }
    if (table.headers.length > 0) {
      table.headers.forEach((h, c) => {
        const cell = ws.getCell(rowIdx, c + 1);
        cell.value = h;
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF1F5F9' },
        };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
        bump(c, h.length);
      });
      rowIdx++;
    }
    for (const r of table.rows) {
      r.forEach((c, colI) => {
        const cell = ws.getCell(rowIdx, colI + 1);
        if (typeof c === 'number') {
          cell.value = c;
          bump(colI, String(c).length);
        } else if (typeof c === 'object') {
          cell.value = c.v;
          cell.numFmt = CURRENCY_FORMAT;
          bump(colI, 14);
        } else {
          cell.value = c;
          bump(colI, Math.min(c.length, 48));
        }
      });
      rowIdx++;
    }
    rowIdx++; // blank row between tables
  }

  colWidths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `${payload.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'report'}.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
