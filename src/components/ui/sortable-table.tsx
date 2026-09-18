'use client';

// Drop-in sortable table for the report / list surfaces.
//
// A server page already knows its rows — it just can't sort them, because
// sorting is interaction and the page is server-rendered. This takes the
// rendered cells AND the raw values behind them, so clicking a header sorts on
// the real value (a date, a number) rather than on the formatted string:
// "$1,037.38" would otherwise sort before "$745.58".
//
// Rows are keyed, so React reorders the existing DOM nodes rather than
// rebuilding them. Columns with no sortValue render as a plain header.

import { useMemo, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  SortableHeader,
  compareValues,
  toggleSort,
  type SortState,
} from '@/components/ui/sortable-header';
import { cn } from '@/lib/utils';

export type SortableColumn = {
  /** Stable id, used as the sort key. */
  key: string;
  label: React.ReactNode;
  align?: 'left' | 'right';
  /** Applied to both the header cell and each body cell in this column. */
  className?: string;
  /** Omit to make the column non-sortable (actions, badges without order). */
  sortable?: boolean;
};

export type SortableRow = {
  id: string;
  /** One per column, in the same order. */
  cells: React.ReactNode[];
  /** Sort value per column, same order. null / undefined sorts last. */
  sortValues?: Array<string | number | null | undefined>;
  /** Applied to the <tr>. */
  className?: string;
};

export function SortableTable({
  columns,
  rows,
  defaultSort = null,
  footer,
  emptyMessage,
}: {
  columns: SortableColumn[];
  rows: SortableRow[];
  defaultSort?: SortState;
  /** Totals row, rendered after the sorted rows and never reordered. */
  footer?: React.ReactNode;
  emptyMessage?: React.ReactNode;
}) {
  const [sort, setSort] = useState<SortState>(defaultSort);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const idx = columns.findIndex((c) => c.key === sort.key);
    if (idx < 0) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    // Stable: index tiebreak keeps the page's natural order within ties.
    return rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const cmp = compareValues(a.r.sortValues?.[idx], b.r.sortValues?.[idx]);
        return cmp !== 0 ? cmp * dir : a.i - b.i;
      })
      .map((x) => x.r);
  }, [rows, sort, columns]);

  if (rows.length === 0 && emptyMessage) {
    return <>{emptyMessage}</>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead
              key={c.key}
              className={cn(c.align === 'right' && 'text-right', c.className)}
            >
              {c.sortable === false ? (
                c.label
              ) : (
                <SortableHeader
                  label={typeof c.label === 'string' ? c.label : ''}
                  sortKey={c.key}
                  sort={sort}
                  onSort={(key) => setSort((prev) => toggleSort(prev, key))}
                  align={c.align}
                />
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => (
          <TableRow key={r.id} className={r.className}>
            {r.cells.map((cell, i) => (
              <TableCell
                key={columns[i]?.key ?? i}
                className={cn(
                  columns[i]?.align === 'right' && 'text-right',
                  columns[i]?.className,
                )}
              >
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
        {footer}
      </TableBody>
    </Table>
  );
}
