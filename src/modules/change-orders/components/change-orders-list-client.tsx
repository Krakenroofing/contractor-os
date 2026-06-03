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
  type ChangeOrderStatus,
} from '@/modules/change-orders/schema';

export type ChangeOrderRow = {
  id: string;
  number: string;
  projectName: string;
  customerName: string;
  proposalNumber: string | null;
  status: ChangeOrderStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  scheduleImpactDays: number;
  total: string;
};

type FilterKey = 'project' | 'customer' | 'status';

export function ChangeOrdersListClient({ rows }: { rows: ChangeOrderRow[] }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    project: new Set(),
    customer: new Set(),
    status: new Set(),
  });
  const [sort, setSort] = useState<SortState>(null);

  const projectOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(rows.map((r) => r.projectName));
    return Array.from(present)
      .sort()
      .map((name) => ({ value: name, label: name }));
  }, [rows]);

  const customerOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(rows.map((r) => r.customerName));
    return Array.from(present)
      .sort()
      .map((name) => ({ value: name, label: name }));
  }, [rows]);

  const statusOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(rows.map((r) => r.status));
    return Array.from(present)
      .sort()
      .map((s) => ({ value: s, label: STATUS_LABEL[s] }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (set: Set<string>, value: string) =>
      set.size === 0 || set.has(value);
    let out = rows.filter((r) => {
      const matchesSearch =
        q === '' ||
        r.number.toLowerCase().includes(q) ||
        r.projectName.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q);
      return (
        matchesSearch &&
        matches(filters.project, r.projectName) &&
        matches(filters.customer, r.customerName) &&
        matches(filters.status, r.status)
      );
    });

    if (sort) {
      const get = (r: ChangeOrderRow): string | number | null => {
        switch (sort.key) {
          case 'number':
            return r.number;
          case 'project':
            return r.projectName;
          case 'customer':
            return r.customerName;
          case 'proposal':
            return r.proposalNumber;
          case 'status':
            return r.status;
          case 'submitted':
            return r.submittedAt;
          case 'approved':
            return r.approvedAt;
          case 'days':
            return r.scheduleImpactDays;
          case 'amount':
            return Number(r.total);
          default:
            return null;
        }
      };
      out = [...out].sort((a, b) => {
        const cmp = compareValues(get(a), get(b));
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, search, filters, sort]);

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
            {rows.length === 0
              ? 'No change orders yet.'
              : 'No change orders match those filters.'}
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
                    label="Proposal"
                    sortKey="proposal"
                    sort={sort}
                    onSortChange={setSort}
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
                    label="Submitted"
                    sortKey="submitted"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </TableHead>
                <TableHead>
                  <ColumnHeader
                    label="Approved"
                    sortKey="approved"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader
                    label="Days"
                    sortKey="days"
                    sort={sort}
                    onSortChange={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader
                    label="Amount"
                    sortKey="amount"
                    sort={sort}
                    onSortChange={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs text-slate-700">
                    {r.number}
                  </TableCell>
                  <TableCell className="font-medium text-slate-900">
                    {r.projectName}
                  </TableCell>
                  <TableCell className="text-slate-600">{r.customerName}</TableCell>
                  <TableCell className="font-mono text-xs text-slate-600">
                    {r.proposalNumber ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {r.submittedAt ?? '—'}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {r.approvedAt ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {r.scheduleImpactDays}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-medium ${
                      Number(r.total) < 0 ? 'text-red-600' : ''
                    }`}
                  >
                    {formatMoney(r.total)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/change-orders/${r.id}`}>
                      <Button size="sm" variant="outline">
                        View Change Order
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
