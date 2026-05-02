'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListToolbar } from '@/components/ui/list-toolbar';
import {
  SortableHeader,
  type SortState,
  compareValues,
  toggleSort,
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
  AGING_BUCKETS,
  BUCKET_LABEL,
  BUCKET_TONE,
  type AgingBucket,
  type AgingRow,
} from '@/modules/accounts-receivable/lib/ar-shared';
import {
  STATUS_LABEL,
  STATUS_TONE,
} from '@/modules/invoices/schema';

const STATUS_OPTIONS = ['draft', 'sent', 'partial', 'overdue'] as const;

export function ARListClient({ rows }: { rows: AgingRow[] }) {
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [bucketFilter, setBucketFilter] = useState<'' | AgingBucket>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'days', dir: 'desc' });

  // Distinct customer + project options derived from data
  const customerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) if (r.customerId) map.set(r.customerId, r.customerName);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.projectId, r.projectName);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      const matchesSearch =
        q === '' ||
        r.invoiceNumber.toLowerCase().includes(q) ||
        r.projectName.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q);
      const matchesCustomer = !customerFilter || r.customerId === customerFilter;
      const matchesProject = !projectFilter || r.projectId === projectFilter;
      const matchesBucket = !bucketFilter || r.bucket === bucketFilter;
      const matchesStatus = !statusFilter || r.derivedStatus === statusFilter;
      return matchesSearch && matchesCustomer && matchesProject && matchesBucket && matchesStatus;
    });

    if (sort) {
      const get = (r: AgingRow): string | number | null => {
        switch (sort.key) {
          case 'invoice':
            return r.invoiceNumber;
          case 'customer':
            return r.customerName;
          case 'project':
            return r.projectName;
          case 'invoiceDate':
            return r.invoiceDate;
          case 'dueDate':
            return r.dueDate;
          case 'total':
            return r.total;
          case 'paid':
            return r.amountPaid;
          case 'balance':
            return r.balance;
          case 'days':
            return r.daysOverdue;
          case 'bucket':
            return r.bucket;
          case 'status':
            return r.derivedStatus;
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
  }, [rows, search, customerFilter, projectFilter, bucketFilter, statusFilter, sort]);

  const onSort = (key: string) => setSort((prev) => toggleSort(prev, key));

  return (
    <div className="space-y-4">
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by invoice #, project, or customer…"
        filters={[
          {
            label: 'Customer',
            value: customerFilter,
            onChange: setCustomerFilter,
            options: customerOptions.map(([id, name]) => ({ value: id, label: name })),
          },
          {
            label: 'Project',
            value: projectFilter,
            onChange: setProjectFilter,
            options: projectOptions.map(([id, name]) => ({ value: id, label: name })),
          },
          {
            label: 'Aging',
            value: bucketFilter,
            onChange: (v) => setBucketFilter(v as '' | AgingBucket),
            options: AGING_BUCKETS.map((b) => ({ value: b, label: BUCKET_LABEL[b] })),
          },
          {
            label: 'Status',
            value: statusFilter,
            onChange: setStatusFilter,
            options: STATUS_OPTIONS.map((s) => ({
              value: s,
              label: s === 'overdue' ? 'Overdue' : STATUS_LABEL[s] ?? s,
            })),
          },
        ]}
        onClear={() => {
          setSearch('');
          setCustomerFilter('');
          setProjectFilter('');
          setBucketFilter('');
          setStatusFilter('');
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No outstanding invoices match those filters.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortableHeader label="Invoice" sortKey="invoice" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Customer" sortKey="customer" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Project" sortKey="project" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Invoice date"
                    sortKey="invoiceDate"
                    sort={sort}
                    onSort={onSort}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Due" sortKey="dueDate" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader label="Total" sortKey="total" sort={sort} onSort={onSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader label="Paid" sortKey="paid" sort={sort} onSort={onSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader label="Balance" sortKey="balance" sort={sort} onSort={onSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader label="Days" sortKey="days" sort={sort} onSort={onSort} align="right" />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Aging" sortKey="bucket" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Status" sortKey="status" sort={sort} onSort={onSort} />
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
                  <TableCell className="text-slate-600">{r.customerName}</TableCell>
                  <TableCell className="font-medium text-slate-900">
                    {r.projectName}
                  </TableCell>
                  <TableCell className="text-slate-600">{r.invoiceDate}</TableCell>
                  <TableCell className="text-slate-600">{r.dueDate ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(r.total)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">
                    {formatMoney(r.amountPaid)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium text-amber-700">
                    {formatMoney(r.balance)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      r.daysOverdue > 0 ? 'text-red-600 font-medium' : 'text-slate-500'
                    }`}
                  >
                    {r.daysOverdue > 0 ? r.daysOverdue : `${r.daysOverdue}`}
                  </TableCell>
                  <TableCell>
                    <Badge tone={BUCKET_TONE[r.bucket]}>{BUCKET_LABEL[r.bucket]}</Badge>
                  </TableCell>
                  <TableCell>
                    {r.derivedStatus === 'overdue' ? (
                      <Badge tone="red">Overdue</Badge>
                    ) : (
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/invoices/${r.invoiceId}`}>
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
