'use client';

// Read-only line table on the PO page. Every column sorts — on a 60-line
// supplier order, finding the one $640.79 adhesive or the one line that
// hasn't come in beats scrolling. Sorting is a view over the rows here;
// the stored line order is untouched.

import { useState } from 'react';
import {
  SortableHeader,
  toggleSort,
  type SortState,
} from '@/components/ui/sortable-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney } from '@/lib/money';
import { sortLines } from '../line-sort';
import type { ProductPickerOption } from '@/modules/inventory/components/product-picker';
import { PoLineProductEditor } from './po-line-product-editor';

export type PoLineRow = {
  id: string;
  costCode: string;
  /** Resolved job name for this line (the PO's project unless overridden). */
  jobName: string;
  /** True when the line books to a job other than the PO's project. */
  jobOverridden: boolean;
  description: string;
  unit: string | null;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: string;
  lineTotal: string;
  inventoryItemId: string;
  inventoryItemName: string | null;
};

export function PoLinesTable({
  lines,
  poId,
  products,
  canEditProducts,
}: {
  lines: PoLineRow[];
  poId: string;
  /** Catalog for the inline product link; empty + !canEditProducts hides the column's editor. */
  products: ProductPickerOption[];
  canEditProducts: boolean;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const onSort = (key: string) => setSort((prev) => toggleSort(prev, key));

  const rows = sortLines(lines, sort, (l) => ({
    description: l.description,
    unit: l.unit,
    quantity: l.quantityOrdered,
    unitCost: Number(l.unitCost),
  }));

  const qty = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <>
      {sort && (
        <div className="flex justify-end px-4 pt-3">
          <button
            type="button"
            onClick={() => setSort(null)}
            className="text-xs text-slate-500 underline hover:text-slate-900"
          >
            Back to entry order
          </button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cost code</TableHead>
            <TableHead>Job</TableHead>
            <TableHead>
              <SortableHeader
                label="Item description"
                sortKey="description"
                sort={sort}
                onSort={onSort}
              />
            </TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">
              <SortableHeader
                label="Qty ordered"
                sortKey="quantity"
                sort={sort}
                onSort={onSort}
                align="right"
              />
            </TableHead>
            <TableHead className="text-right">Qty received</TableHead>
            <TableHead>
              <SortableHeader
                label="Unit"
                sortKey="unit"
                sort={sort}
                onSort={onSort}
              />
            </TableHead>
            <TableHead className="text-right">
              <SortableHeader
                label="Unit cost"
                sortKey="unitCost"
                sort={sort}
                onSort={onSort}
                align="right"
              />
            </TableHead>
            <TableHead className="text-right">
              <SortableHeader
                label="Line total"
                sortKey="total"
                sort={sort}
                onSort={onSort}
                align="right"
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="font-mono text-xs text-slate-700">
                {l.costCode}
              </TableCell>
              <TableCell className="text-xs">
                {l.jobOverridden ? (
                  <span
                    className="inline-block rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-sky-700"
                    title="This line books to a different job than the PO's project"
                  >
                    {l.jobName}
                  </span>
                ) : (
                  <span className="text-slate-600">{l.jobName}</span>
                )}
              </TableCell>
              <TableCell className="text-slate-900">{l.description}</TableCell>
              <TableCell className="text-xs">
                {canEditProducts ? (
                  <PoLineProductEditor
                    poId={poId}
                    lineId={l.id}
                    itemId={l.inventoryItemId}
                    itemName={l.inventoryItemName}
                    description={l.description}
                    products={products}
                  />
                ) : (
                  <span className="text-slate-600">
                    {l.inventoryItemName ?? '—'}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {qty(l.quantityOrdered)}
              </TableCell>
              <TableCell
                className={`text-right tabular-nums ${
                  l.quantityReceived < l.quantityOrdered
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }`}
              >
                {qty(l.quantityReceived)}
              </TableCell>
              <TableCell className="text-slate-600">{l.unit ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(l.unitCost)}
              </TableCell>
              <TableCell className="text-right tabular-nums font-medium">
                {formatMoney(l.lineTotal)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
