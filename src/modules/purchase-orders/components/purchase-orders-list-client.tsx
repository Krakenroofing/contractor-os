'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ColumnHeader,
  type FilterOption,
} from '@/components/ui/column-header';
import { ListToolbar } from '@/components/ui/list-toolbar';
import {
  compareValues,
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
import {
  STATUS_LABEL,
  STATUS_TONE,
} from '@/modules/purchase-orders/schema';
import type { PurchaseOrder } from '@/db/schema';

export type PORow = {
  id: string;
  number: string;
  vendorId: string;
  vendorName: string;
  projectName: string;
  status: PurchaseOrder['status'];
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  subtotal: string;
  taxAmount: string;
  shipping: string;
  total: string;
};

type FilterKey = 'vendor' | 'project' | 'status';

export function PurchaseOrdersListClient({
  pos,
}: {
  pos: PORow[];
  vendors?: { id: string; label: string }[];
}) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    vendor: new Set(),
    project: new Set(),
    status: new Set(),
  });
  // Numerical order by PO number out of the box (PO2 before PO012 before
  // PO0018) — click any column header to re-sort.
  const [sort, setSort] = useState<SortState>({ key: 'number', dir: 'asc' });

  const vendorOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    for (const p of pos) map.set(p.vendorId, p.vendorName);
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [pos]);

  const projectOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(pos.map((p) => p.projectName));
    return Array.from(present)
      .sort()
      .map((name) => ({ value: name, label: name }));
  }, [pos]);

  const statusOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(pos.map((p) => p.status));
    return Array.from(present)
      .sort()
      .map((s) => ({ value: s, label: STATUS_LABEL[s] }));
  }, [pos]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (set: Set<string>, value: string) =>
      set.size === 0 || set.has(value);
    let rows = pos.filter((p) => {
      const matchesSearch =
        q === '' ||
        p.number.toLowerCase().includes(q) ||
        p.vendorName.toLowerCase().includes(q) ||
        p.projectName.toLowerCase().includes(q);
      return (
        matchesSearch &&
        matches(filters.vendor, p.vendorId) &&
        matches(filters.project, p.projectName) &&
        matches(filters.status, p.status)
      );
    });

    if (sort) {
      const get = (p: PORow): string | number | null => {
        switch (sort.key) {
          case 'number':
            return p.number;
          case 'vendor':
            return p.vendorName;
          case 'project':
            return p.projectName;
          case 'status':
            return p.status;
          case 'order':
            return p.issueDate;
          case 'expected':
            return p.expectedDeliveryDate;
          case 'subtotal':
            return Number(p.subtotal);
          case 'total':
            return Number(p.total);
          default:
            return null;
        }
      };
      rows = [...rows].sort((a, b) => {
        // PO numbers sort numerically (PO2 < PO012 < PO0018), not lexically.
        const cmp =
          sort.key === 'number'
            ? a.number.localeCompare(b.number, undefined, {
                numeric: true,
                sensitivity: 'base',
              })
            : compareValues(get(a), get(b));
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [pos, search, filters, sort]);

  const setFilter = (key: FilterKey) => (next: Set<string>) =>
    setFilters((prev) => ({ ...prev, [key]: next }));

  // Summary KPIs across the filtered set
  const totalCommitted = filtered
    .filter((p) => p.status !== 'void')
    .reduce((a, p) => a + Number(p.total), 0);
  const openCount = filtered.filter(
    (p) => p.status !== 'received' && p.status !== 'closed' && p.status !== 'void',
  ).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPI label="Total committed spend" value={formatMoney(totalCommitted)} />
        <KPI label="Open POs" value={String(openCount)} sub="not yet fully received" />
        <KPI label="POs in view" value={String(filtered.length)} />
      </div>

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by number, vendor, or project…"
        onClear={() => {
          setSearch('');
          setFilters({
            vendor: new Set(),
            project: new Set(),
            status: new Set(),
          });
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">
            {pos.length === 0
              ? 'No purchase orders yet.'
              : 'No purchase orders match those filters.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <ColumnHeader
                    label="Number"
                    sortKey="number"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </TableHead>
                <TableHead>
                  <ColumnHeader
                    label="Vendor"
                    sortKey="vendor"
                    sort={sort}
                    onSortChange={setSort}
                    filterOptions={vendorOptions}
                    filterValues={filters.vendor}
                    onFilterChange={setFilter('vendor')}
                  />
                </TableHead>
                <TableHead>
                  <ColumnHeader
                    label="Project"
                    sortKey="project"
                    sort={sort}
                    onSortChange={setSort}
                    filterOptions={projectOptions}
                    filterValues={filters.project}
                    onFilterChange={setFilter('project')}
                  />
                </TableHead>
                <TableHead>
                  <ColumnHeader
                    label="Status"
                    sortKey="status"
                    sort={sort}
                    onSortChange={setSort}
                    filterOptions={statusOptions}
                    filterValues={filters.status}
                    onFilterChange={setFilter('status')}
                  />
                </TableHead>
                <TableHead>
                  <ColumnHeader
                    label="Order date"
                    sortKey="order"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </TableHead>
                <TableHead>
                  <ColumnHeader
                    label="Expected"
                    sortKey="expected"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader
                    label="Subtotal"
                    sortKey="subtotal"
                    sort={sort}
                    onSortChange={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader
                    label="Total"
                    sortKey="total"
                    sort={sort}
                    onSortChange={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs text-slate-700">
                    {p.number}
                  </TableCell>
                  <TableCell className="font-medium text-slate-900">
                    {p.vendorName}
                  </TableCell>
                  <TableCell className="text-slate-600">{p.projectName}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">{p.issueDate ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">
                    {p.expectedDeliveryDate ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(p.subtotal)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatMoney(p.total)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/purchase-orders/${p.id}`}>
                      <Button size="sm" variant="outline">
                        View Purchase Order
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </CardContent>
    </Card>
  );
}
