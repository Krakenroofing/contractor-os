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
import { formatMoney, formatPercent } from '@/lib/money';
import {
  RETAINAGE_STATUSES,
  STATUS_LABEL,
  STATUS_TONE,
  type RetainageRow,
  type RetainageStatus,
} from '@/modules/retainage/lib/retainage-shared';

export function RetainageListClient({
  rows,
  allowCreate,
}: {
  rows: RetainageRow[];
  allowCreate: boolean;
}) {
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | RetainageStatus>('');
  const [sort, setSort] = useState<SortState>({ key: 'status', dir: 'asc' });

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
      const matchesStatus = !statusFilter || r.status === statusFilter;
      return matchesSearch && matchesCustomer && matchesProject && matchesStatus;
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
  }, [rows, search, customerFilter, projectFilter, statusFilter, sort]);

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
            label: 'Status',
            value: statusFilter,
            onChange: (v) => setStatusFilter(v as '' | RetainageStatus),
            options: RETAINAGE_STATUSES.map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            })),
          },
        ]}
        onClear={() => {
          setSearch('');
          setCustomerFilter('');
          setProjectFilter('');
          setStatusFilter('');
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">
            No retainage rows match those filters. Retainage shows up here as soon as
            an invoice is issued with a retainage % set.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
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
                <TableHead className="text-right">
                  <SortableHeader label="Contract" sortKey="contract" sort={sort} onSort={onSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader label="Invoiced" sortKey="invoiced" sort={sort} onSort={onSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader label="%" sortKey="pct" sort={sort} onSort={onSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader label="Held" sortKey="held" sort={sort} onSort={onSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader label="Released" sortKey="released" sort={sort} onSort={onSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader label="Balance" sortKey="balance" sort={sort} onSort={onSort} align="right" />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Expected" sortKey="expected" sort={sort} onSort={onSort} />
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
