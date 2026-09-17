// Sorting for a PO's line items. Long POs (100+ lines from an Excel import
// or a supplier order) are painful to scan in entry order, so every line
// column can be sorted — on the read-only PO page and inside both edit
// forms. In the forms the sort reorders the draft rows themselves, so what
// you see is what saves (line order persists as sort_order on save).

import { compareValues, type SortState } from '@/components/ui/sortable-header';

export type SortableLine = {
  description: string;
  unit: string | null;
  quantity: number;
  unitCost: number;
};

export function lineSortValue(
  line: SortableLine,
  key: string,
): string | number | null {
  switch (key) {
    case 'description':
      // Blank descriptions sort last either way — compareValues parks nulls.
      return line.description.trim().toLowerCase() || null;
    case 'unit':
      return line.unit?.trim().toLowerCase() || null;
    case 'quantity':
      return line.quantity;
    case 'unitCost':
      return line.unitCost;
    case 'total':
      return line.quantity * line.unitCost;
    default:
      return null;
  }
}

/** Order rows by `sort`; a null sort leaves them in entry order. */
export function sortLines<T>(
  rows: T[],
  sort: SortState,
  toSortable: (row: T) => SortableLine,
): T[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const cmp = compareValues(
      lineSortValue(toSortable(a), sort.key),
      lineSortValue(toSortable(b), sort.key),
    );
    return sort.dir === 'asc' ? cmp : -cmp;
  });
}
