'use client';

// Client-side sortable table for the P&L revenue drill-down. All rows are
// loaded server-side (no pagination), so sorting is instant in the browser —
// click any column header to sort, click again to flip direction. Mirrors the
// QuickBooks transaction-report behavior the operator compares against.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney } from '@/lib/money';

export type RevenueTableEntry = {
  invoiceId: string;
  number: string;
  date: string;
  customerName: string;
  projectName: string;
  categoryName: string | null;
  subtotal: number;
  total: number;
};

type SortKey = 'date' | 'number' | 'customer' | 'category' | 'subtotal' | 'total';
type SortDir = 'asc' | 'desc';

const TEXT_COMPARE = { numeric: true, sensitivity: 'base' } as const;

export function RevenueTable({
  entries,
  exTax,
  total,
}: {
  entries: RevenueTableEntry[];
  exTax: string;
  total: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const tieBreak = (a: RevenueTableEntry, b: RevenueTableEntry) =>
      a.date.localeCompare(b.date) ||
      a.number.localeCompare(b.number, undefined, TEXT_COMPARE);
    return [...entries].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = a.date.localeCompare(b.date);
          break;
        case 'number':
          cmp = a.number.localeCompare(b.number, undefined, TEXT_COMPARE);
          break;
        case 'customer':
          cmp =
            a.customerName.localeCompare(b.customerName, undefined, TEXT_COMPARE) ||
            a.projectName.localeCompare(b.projectName, undefined, TEXT_COMPARE);
          break;
        case 'category':
          cmp = (a.categoryName ?? 'Uncategorized').localeCompare(
            b.categoryName ?? 'Uncategorized',
            undefined,
            TEXT_COMPARE,
          );
          break;
        case 'subtotal':
          cmp = a.subtotal - b.subtotal;
          break;
        case 'total':
          cmp = a.total - b.total;
          break;
      }
      if (cmp === 0) return tieBreak(a, b);
      return cmp * dir;
    });
  }, [entries, sortKey, sortDir]);

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Amounts most often want largest-first; text columns A→Z.
      setSortDir(key === 'subtotal' || key === 'total' ? 'desc' : 'asc');
    }
  }

  const headerProps = { sortKey, sortDir, onSort: toggle };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHeader label="Date" col="date" className="w-28" {...headerProps} />
          <SortHeader label="Invoice" col="number" className="w-28" {...headerProps} />
          <SortHeader label="Customer / Project" col="customer" {...headerProps} />
          <SortHeader label="Revenue category" col="category" {...headerProps} />
          <SortHeader label={exTax} col="subtotal" align="right" className="w-32" {...headerProps} />
          <SortHeader label="Gross" col="total" align="right" className="w-32" {...headerProps} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((e) => (
          <TableRow key={e.invoiceId}>
            <TableCell className="tabular-nums text-slate-700">{e.date}</TableCell>
            <TableCell>
              <Link
                href={`/invoices/${e.invoiceId}`}
                target="_blank"
                className="text-blue-700 hover:underline"
              >
                {e.number || '—'} ↗
              </Link>
            </TableCell>
            <TableCell className="text-slate-900">
              <span className="block">{e.customerName}</span>
              <span className="block text-xs text-slate-500">{e.projectName}</span>
            </TableCell>
            <TableCell
              className={e.categoryName ? 'text-slate-700' : 'text-amber-700'}
            >
              {e.categoryName ?? 'Uncategorized'}
            </TableCell>
            <TableCell className="text-right tabular-nums font-medium">
              {formatMoney(e.subtotal)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-slate-500">
              {formatMoney(e.total)}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t-2 border-slate-200">
          <TableCell colSpan={4} className="font-semibold text-slate-900">
            Total ({exTax})
          </TableCell>
          <TableCell className="text-right tabular-nums font-semibold">
            {formatMoney(total)}
          </TableCell>
          <TableCell />
        </TableRow>
      </TableBody>
    </Table>
  );
}

function SortHeader({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align,
  className,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'right';
  className?: string;
}) {
  const active = sortKey === col;
  return (
    <TableHead className={`${align === 'right' ? 'text-right' : ''} ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 hover:text-slate-900 ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-slate-900' : ''}`}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span>{label}</span>
        <span
          className={`text-[10px] leading-none ${active ? 'text-slate-600' : 'text-slate-300'}`}
          aria-hidden
        >
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </TableHead>
  );
}
