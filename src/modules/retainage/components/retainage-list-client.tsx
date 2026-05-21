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
import { formatMoney, formatPercent } from '@/lib/money';
import {
  STATUS_LABEL,
  STATUS_TONE,
  type RetainageRow,
} from '@/modules/retainage/lib/retainage-shared';

type FilterKey = 'customer' | 'project' | 'status';

export function RetainageListClient({
  rows,
  allowCreate,
}: {
  rows: RetainageRow[];
  allowCreate: boolean;
}) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    customer: new Set(),
    project: new Set(),
    status: new Set(),
  });
  const [sort, setSort] = useState<SortState>(null);

  const customerOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    for (const r of rows) if (r.customerId) map.set(r.customerId, r.customerName);
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [rows]);

  const projectOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.projectId, r.projectName);
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
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
        r.invoiceNumber.toLowerCase().includes(q) ||
        r.projectName.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q);
      return (
        matchesSearch &&
        matches(filters.customer, r.customerId ?? '') &&
        matches(filters.project, r.projectId) &&
        matches(filters.status, r.status)
      );
    });

    if (sort) {
      const get = (r: RetainageRow): string | number | null => {
        switch (sort.key) {
          case 'invoice':
            return r.invoiceNumber;
          case 'customer':
            return r.customerName;
          case 'project':
            return r.projectName;
          case 'contract':
            return r.contractValue;
          case 'invoiced':
            return r.totalInvoiced;
          case 'pct':
            return r.retainagePercent;
          case 'held':
            return r.retainageHeld;
          case 'released':
            return r.retainageReleased;
          case 'balance':
            return r.retainageBalance;
          case 'expected':
            return r.expectedReleaseDate;
          case 'status':
            return r.status;
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
        searchPlaceholder="Search by invoice #, project, or customer…"
        onClear={() => {
          setSearch('');
          setFilters({
            customer: new Set(),
            project: new Set(),
            status: new Set(),
          });
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">
            {rows.length === 0
              ? 'No retainage rows yet. Retainage shows up here as soon as an invoice is issued with a retainage % set.'
              : 'No retainage rows match those filters.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <ColumnHeader label="Invoice" sortKey="invoice" sort={sort} onSortChange={setSort} />
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
                    label="Project"
                    sortKey="project"
                    sort={sort}
                    onSortChange={setSort}
                    filterOptions={projectOptions}
                    filterValues={filters.project}
                    onFilterChange={setFilter('project')}
                  />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader label="Contract" sortKey="contract" sort={sort} onSortChange={setSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader label="Invoiced" sortKey="invoiced" sort={sort} onSortChange={setSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader label="%" sortKey="pct" sort={sort} onSortChange={setSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader label="Held" sortKey="held" sort={sort} onSortChange={setSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader label="Released" sortKey="released" sort={sort} onSortChange={setSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader label="Balance" sortKey="balance" sort={sort} onSortChange={setSort} align="right" />
                </TableHead>
                <TableHead>
                  <ColumnHeader label="Expected" sortKey="expected" sort={sort} onSortChange={setSort} />
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
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.invoiceId}>
                  <TableCell className="font-mono text-xs text-slate-700">
                    <Link href={`/invoices/${r.invoiceId}`} className="hover:underline">
                      {r.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600 whitespace-nowrap">
                    {r.customerName}
                  </TableCell>
                  <TableCell className="font-medium text-slate-900">
                    <Link href={`/projects/${r.projectId}`} className="hover:underline">
                      {r.projectName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {r.contractValue > 0 ? formatMoney(r.contractValue) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {formatMoney(r.totalInvoiced)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {formatPercent(r.retainagePercent, 2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(r.retainageHeld)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">
                    {formatMoney(r.retainageReleased)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-medium ${
                      r.retainageBalance > 0 ? 'text-amber-700' : 'text-emerald-700'
                    }`}
                  >
                    {formatMoney(r.retainageBalance)}
                  </TableCell>
                  <TableCell className="text-slate-600 whitespace-nowrap">
                    {r.expectedReleaseDate ? (
                      <span
                        className={
                          r.status === 'overdue'
                            ? 'text-red-600 font-medium'
                            : undefined
                        }
                      >
                        {r.expectedReleaseDate}
                        {r.status === 'overdue' &&
                          r.daysUntilRelease !== null &&
                          ` (${Math.abs(r.daysUntilRelease)}d late)`}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[r.status]}>
                      {STATUS_LABEL[r.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {allowCreate && r.retainageBalance > 0 ? (
                      <Link href={`/retainage/${r.invoiceId}/release`}>
                        <Button size="sm" variant="outline">
                          Release
                        </Button>
                      </Link>
                    ) : (
                      <Link href={`/invoices/${r.invoiceId}`}>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
                    )}
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
