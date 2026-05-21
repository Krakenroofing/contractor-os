'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ColumnHeader,
  type FilterOption,
} from '@/components/ui/column-header';
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
  BILLING_TYPE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  type BillingType,
  type InvoiceStatus,
} from '@/modules/invoices/schema';

export type InvoiceListRow = {
  id: string;
  number: string;
  projectId: string;
  projectName: string;
  customerId: string | null;
  customerName: string;
  billingType: BillingType;
  status: InvoiceStatus;
  invoiceDate: string;
  dueDate: string | null;
  total: number;
  subtotal: number;
  taxAmount: number;
  balance: number;
};

type ColumnKey =
  | 'number'
  | 'project'
  | 'customer'
  | 'type'
  | 'status'
  | 'invoiceDate'
  | 'dueDate'
  | 'total'
  | 'balance';

type FilterKey = 'project' | 'customer' | 'type' | 'status';

export function InvoicesListClient({
  rows,
  allowCreate,
}: {
  rows: InvoiceListRow[];
  allowCreate: boolean;
}) {
  // Empty filter set means "no filter applied" — every row is visible
  // until the user explicitly checks something in a header dropdown.
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>(
    () => ({
      project: new Set<string>(),
      customer: new Set<string>(),
      type: new Set<string>(),
      status: new Set<string>(),
    }),
  );
  const [sort, setSort] = useState<SortState>(null);

  const projectOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.projectId, r.projectName);
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [rows]);

  const customerOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.customerId ?? '', r.customerName);
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [rows]);

  const typeOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(rows.map((r) => r.billingType));
    return Array.from(present)
      .sort()
      .map((value) => ({ value, label: BILLING_TYPE_LABEL[value] }));
  }, [rows]);

  const statusOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(rows.map((r) => r.status));
    return Array.from(present)
      .sort()
      .map((value) => ({ value, label: STATUS_LABEL[value] }));
  }, [rows]);

  const filtered = useMemo(() => {
    const matches = (set: Set<string>, value: string) =>
      set.size === 0 || set.has(value);
    let out = rows.filter(
      (r) =>
        matches(filters.project, r.projectId) &&
        matches(filters.customer, r.customerId ?? '') &&
        matches(filters.type, r.billingType) &&
        matches(filters.status, r.status),
    );

    if (sort) {
      const get = (r: InvoiceListRow): string | number | null => {
        switch (sort.key as ColumnKey) {
          case 'number':
            return r.number;
          case 'project':
            return r.projectName;
          case 'customer':
            return r.customerName;
          case 'type':
            return BILLING_TYPE_LABEL[r.billingType];
          case 'status':
            return STATUS_LABEL[r.status];
          case 'invoiceDate':
            return r.invoiceDate;
          case 'dueDate':
            return r.dueDate;
          case 'total':
            return r.total;
          case 'balance':
            return r.balance;
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
  }, [rows, filters, sort]);

  const setFilter = (key: FilterKey) => (next: Set<string>) =>
    setFilters((prev) => ({ ...prev, [key]: next }));

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
        <p className="text-slate-600">No invoices yet.</p>
        {allowCreate && (
          <div className="mt-4 inline-flex">
            <Link href="/invoices/new">
              <Button>New Invoice</Button>
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
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
                label="Type"
                sortKey="type"
                sort={sort}
                onSortChange={setSort}
                filterOptions={typeOptions}
                filterValues={filters.type}
                onFilterChange={setFilter('type')}
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
                label="Invoice date"
                sortKey="invoiceDate"
                sort={sort}
                onSortChange={setSort}
              />
            </TableHead>
            <TableHead>
              <ColumnHeader
                label="Due"
                sortKey="dueDate"
                sort={sort}
                onSortChange={setSort}
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
            <TableHead className="text-right">
              <ColumnHeader
                label="Balance"
                sortKey="balance"
                sort={sort}
                onSortChange={setSort}
                align="right"
              />
            </TableHead>
            <TableHead className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="py-12 text-center text-slate-500">
                No invoices match those filters.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((r) => {
              const isVoid = r.status === 'void';
              const canEditRow = allowCreate && !isVoid;
              const canRecordPayment =
                allowCreate && !isVoid && r.status !== 'paid';
              return (
                <TableRow key={r.id} className={isVoid ? 'opacity-60' : ''}>
                  <TableCell className="font-mono text-xs text-slate-700">
                    {r.number}
                  </TableCell>
                  <TableCell className="font-medium text-slate-900">
                    {r.projectName}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {r.customerName}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {BILLING_TYPE_LABEL[r.billingType]}
                  </TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[r.status]}>
                      {STATUS_LABEL[r.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {r.invoiceDate}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {r.dueDate ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    <div>{formatMoney(r.total)}</div>
                    {r.taxAmount > 0 && (
                      <div className="text-[11px] font-normal text-slate-500">
                        net {formatMoney(r.subtotal)} ·{' '}
                        VAT {formatMoney(r.taxAmount)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      r.balance <= 0 ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {formatMoney(r.balance)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/invoices/${r.id}`}>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
                      {canEditRow && (
                        <Link href={`/invoices/${r.id}/edit`}>
                          <Button size="sm" variant="outline">
                            Edit
                          </Button>
                        </Link>
                      )}
                      {canRecordPayment && (
                        <Link href={`/payments/new?invoiceId=${r.id}`}>
                          <Button size="sm" variant="outline">
                            Pay
                          </Button>
                        </Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
