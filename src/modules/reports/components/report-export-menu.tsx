'use client';

// One export control for EVERY report and drill-down (mounted by the
// /reports layout): "Export ▾" → PDF (browser print — the app already ships
// print styles) or Excel (scrapes the rendered tables and posts them to
// /api/export/report-xlsx for a real .xlsx). Zero per-report wiring: any
// page that renders <table> elements exports as-is.

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type Cell = string | number | { v: number; cur: true };

// "$1,234.56", "(1,234.56)", "-12", "1,234" → number; anything else stays text.
function parseCell(text: string): Cell {
  const raw = text.trim();
  if (raw === '' || raw === '—' || raw === '–' || raw === '-') return '';
  const isParen = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/^\(|\)$/g, '').trim();
  const isCurrency = /^[-$]*\$/.test(cleaned) || /^BSD|^USD/.test(cleaned);
  const numeric = cleaned.replace(/^(BSD|USD)\s*/i, '').replace(/[$,]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(numeric)) {
    const n = Number(numeric) * (isParen ? -1 : 1);
    if (isCurrency) return { v: n, cur: true };
    // Keep identifiers that merely look numeric (dates, invoice numbers with
    // no separators) as numbers only when short-ish; safest: numbers stay
    // numbers, dates never match this regex (they contain dashes mid-string).
    return n;
  }
  return raw;
}

function nearestCaption(table: HTMLTableElement): string | undefined {
  // Closest preceding h2-h4 in document order (h1 is the page title).
  const headings = Array.from(document.querySelectorAll('h2, h3, h4'));
  let best: Element | undefined;
  for (const h of headings) {
    const pos = table.compareDocumentPosition(h);
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) best = h;
  }
  return best?.textContent?.trim() || undefined;
}

function scrapeTables(): {
  title: string;
  subtitle: string;
  tables: { caption?: string; headers: string[]; rows: Cell[][] }[];
} {
  const title =
    document.querySelector('h1')?.textContent?.trim() ||
    document.title ||
    'Report';
  const subtitle = `Exported ${new Date().toLocaleString()} — ${window.location.pathname}${window.location.search}`;
  const tables: { caption?: string; headers: string[]; rows: Cell[][] }[] = [];
  for (const table of Array.from(document.querySelectorAll('table'))) {
    // Skip hidden tables and anything explicitly opted out.
    if (table.closest('[data-export="skip"]')) continue;
    if (table.offsetParent === null) continue;
    const headers = Array.from(
      table.querySelectorAll('thead th, thead td'),
    ).map((h) => h.textContent?.trim() ?? '');
    const rows: Cell[][] = [];
    for (const tr of Array.from(table.querySelectorAll('tbody tr'))) {
      const cells = Array.from(tr.querySelectorAll('td, th')).map((td) =>
        parseCell(td.textContent ?? ''),
      );
      if (cells.some((c) => c !== '')) rows.push(cells);
    }
    if (rows.length === 0 && headers.every((h) => h === '')) continue;
    tables.push({ caption: nearestCaption(table), headers, rows });
  }
  return { title, subtitle, tables };
}

export function ReportExportMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function exportExcel() {
    setError(null);
    setBusy(true);
    setOpen(false);
    try {
      const payload = scrapeTables();
      if (payload.tables.length === 0) {
        setError('Nothing to export on this page.');
        return;
      }
      const res = await fetch('/api/export/report-xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError('Export failed — try again.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        res.headers
          .get('Content-Disposition')
          ?.match(/filename="([^"]+)"/)?.[1] ?? 'report.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative print:hidden">
      <div className="flex items-center gap-2">
        {error && <span className="text-xs text-red-600">{error}</span>}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
          title="Export this report"
        >
          {busy ? 'Exporting…' : 'Export ▾'}
        </Button>
      </div>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-44 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={exportExcel}
          >
            Excel (.xlsx)
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setOpen(false);
              window.print();
            }}
          >
            PDF (print / save)
          </button>
        </div>
      )}
    </div>
  );
}
