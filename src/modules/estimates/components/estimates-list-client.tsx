'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
} from '@/modules/estimates/schema';
import type { Estimate } from '@/db/schema';

export type EstimateRow = {
  id: string;
  number: string;
  projectId: string;
  projectName: string;
  customerName: string;
  status: Estimate['status'];
  createdAt: string;
  subtotal: string;
  total: string;
};

type FilterKey = 'project' | 'customer' | 'status';

export function EstimatesListClient({
  estimates,
}: {
  estimates: EstimateRow[];
  projects?: { id: string; label: string }[];
}) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    project: new Set(),
    customer: new Set(),
    status: new Set(),
  });
  const [sort, setSort] = useState<SortState>(null);

  const projectOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    for (const e of estimates) map.set(e.projectId, e.projectName);
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [estimates]);

  const customerOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(estimates.map((e) => e.customerName));
    return Array.from(present)
      .sort()
      .map((name) => ({ value: name, label: name }));
  }, [estimates]);

  const statusOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(estimates.map((e) => e.status));
    return Array.from(present)
      .sort()
      .map((s) => ({ value: s, label: STATUS_LABEL[s] }));
  }, [estimates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (set: Set<string>, value: string) =>
      set.size === 0 || set.has(value);
    let rows = estimates.filter((e) => {
      const matchesSearch =
        q === '' ||
        e.number.toLowerCase().includes(q) ||
        e.projectName.toLowerCase().includes(q) ||
        e.customerName.toLowerCase().includes(q);
      return (
        matchesSearch &&
        matches(filters.project, e.projectId) &&
        matches(filters.customer, e.customerName) &&
        matches(filters.status, e.status)
      );
    });

    if (sort) {
      const get = (e: EstimateRow): string | number | null => {
        switch (sort.key) {
          case 'number':
            return e.number;
          case 'project':
            return e.projectName;
          case 'customer':
            return e.customerName;
          case 'status':
            return e.status;
          case 'created':
            return e.createdAt;
          case 'subtotal':
            return Number(e.subtotal);
          case 'total':
            return Number(e.total);
          default:
            return null;
        }
      };
      rows = [...rows].sort((a, b) => {
        const cmp = compareValues(get(a), get(b));
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [estimates, search, filters, sort]);

  const setFilter = (key: FilterKey) => (next: Set<string>) =>
    setFilters((prev) => ({ ...prev, [key]: next }));

  return (
    <div className="space-y-4">
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by number, project, or customer…"
        onClear={() => {
          setSearch('');
          setFilters({
            project: new Set(),
            customer: new Set(),
            status: new Set(),
          });
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">
            {estimates.length === 0
              ? 'No estimates yet.'
              : 'No estimates match those filters.'}
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
                    label="Customer"
                    sortKey="customer"
                    sort={sort}
                    onSortChange={setSort}
                    filterOptions={customerOptions}
                    filterValues={filters.customer}
                    onFilterChange={setFilter('customer')}
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
                    label="Created"
                    sortKey="created"
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
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs text-slate-700">
                    {e.number}
                  </TableCell>
                  <TableCell className="font-medium text-slate-900">
                    {e.projectName}
                  </TableCell>
                  <TableCell className="text-slate-600">{e.customerName}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">{e.createdAt}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {formatMoney(e.subtotal)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatMoney(e.total)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/estimates/${e.id}`}>
                      <Button size="sm" variant="outline">
                        View Estimate
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
