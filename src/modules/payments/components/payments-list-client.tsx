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
  METHOD_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  type PaymentMethod,
  type PaymentStatus,
} from '@/modules/payments/schema';

export type PaymentRow = {
  id: string;
  paymentNumber: string;
  paidDate: string;
  customerId: string | null;
  customerName: string;
  projectId: string | null;
  projectName: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  method: PaymentMethod;
  reference: string | null;
  bankAccount: string | null;
  status: PaymentStatus;
  amount: string;
};

type FilterKey = 'customer' | 'project' | 'method' | 'status';

export function PaymentsListClient({ rows }: { rows: PaymentRow[] }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    customer: new Set(),
    project: new Set(),
    method: new Set(),
    status: new Set(),
  });
  const [sort, setSort] = useState<SortState>(null);

  const customerOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(rows.map((r) => r.customerName));
    return Array.from(present)
      .sort()
      .map((name) => ({ value: name, label: name }));
  }, [rows]);

  const projectOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(rows.map((r) => r.projectName));
    return Array.from(present)
      .sort()
      .map((name) => ({ value: name, label: name }));
  }, [rows]);

  const methodOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(rows.map((r) => r.method));
    return Array.from(present)
      .sort()
      .map((m) => ({ value: m, label: METHOD_LABEL[m] }));
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
        r.paymentNumber.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.projectName.toLowerCase().includes(q) ||
        (r.invoiceNumber ?? '').toLowerCase().includes(q) ||
        (r.reference ?? '').toLowerCase().includes(q);
      return (
        matchesSearch &&
        matches(filters.customer, r.customerName) &&
        matches(filters.project, r.projectName) &&
        matches(filters.method, r.method) &&
        matches(filters.status, r.status)
      );
    });

    if (sort) {
      const get = (r: PaymentRow): string | number | null => {
        switch (sort.key) {
          case 'number':
            return r.paymentNumber;
          case 'date':
            return r.paidDate;
          case 'customer':
            return r.customerName;
          case 'project':
            return r.projectName;
          case 'invoice':
            return r.invoiceNumber;
          case 'method':
            return r.method;
          case 'reference':
            return r.reference;
          case 'bank':
            return r.bankAccount;
          case 'status':
            return r.status;
          case 'amount':
            return Number(r.amount);
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
        searchPlaceholder="Search by number, customer, project, invoice #, or reference…"
        onClear={() => {
          setSearch('');
          setFilters({
            customer: new Set(),
            project: new Set(),
            method: new Set(),
            status: new Set(),
          });
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">
            {rows.length === 0
              ? 'No payments recorded yet.'
              : 'No payments match those filters.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <ColumnHeader label="Number" sortKey="number" sort={sort} onSortChange={setSort} />
                </TableHead>
                <TableHead>
                  <ColumnHeader label="Date" sortKey="date" sort={sort} onSortChange={setSort} />
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
                <TableHead>
                  <ColumnHeader label="Invoice" sortKey="invoice" sort={sort} onSortChange={setSort} />
                </TableHead>
                <TableHead>
                  <ColumnHeader
                    label="Method"
                    sortKey="method"
                    sort={sort}
                    onSortChange={setSort}
                    filterOptions={methodOptions}
                    filterValues={filters.method}
                    onFilterChange={setFilter('method')}
                  />
                </TableHead>
                <TableHead>
                  <ColumnHeader label="Reference" sortKey="reference" sort={sort} onSortChange={setSort} />
                </TableHead>
                <TableHead>
                  <ColumnHeader label="Bank" sortKey="bank" sort={sort} onSortChange={setSort} />
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
                <TableHead className="text-right">
                  <ColumnHeader label="Amount" sortKey="amount" sort={sort} onSortChange={setSort} align="right" />
                </TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs text-slate-700">
                    {r.paymentNumber || '—'}
                  </TableCell>
                  <TableCell className="text-slate-600">{r.paidDate}</TableCell>
                  <TableCell className="text-slate-600">{r.customerName}</TableCell>
                  <TableCell className="font-medium text-slate-900">
                    {r.projectName}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.invoiceId && r.invoiceNumber ? (
                      <Link
                        href={`/invoices/${r.invoiceId}`}
                        className="hover:underline text-slate-700"
                      >
                        {r.invoiceNumber}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {METHOD_LABEL[r.method]}
                  </TableCell>
                  <TableCell className="text-slate-600 font-mono text-xs">
                    {r.reference ?? '—'}
                  </TableCell>
                  <TableCell className="text-slate-600 text-xs">
                    {r.bankAccount ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatMoney(r.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/payments/${r.id}`}>
                      <Button size="sm" variant="outline">
                        View
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
