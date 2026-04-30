'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  STATUS_LABEL,
  STATUS_TONE,
  poStatusValues,
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

export function PurchaseOrdersListClient({
  pos,
  vendors,
}: {
  pos: PORow[];
  vendors: { id: string; label: string }[];
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [sort, setSort] = useState<SortState>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = pos.filter((p) => {
      const matchesSearch =
        q === '' ||
        p.number.toLowerCase().includes(q) ||
        p.vendorName.toLowerCase().includes(q) ||
        p.projectName.toLowerCase().includes(q);
      const matchesStatus = !statusFilter || p.status === statusFilter;
      const matchesVendor = !vendorFilter || p.vendorId === vendorFilter;
      return matchesSearch && matchesStatus && matchesVendor;
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
        const cmp = compareValues(get(a), get(b));
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [pos, search, statusFilter, vendorFilter, sort]);

  const onSort = (key: string) => setSort((prev) => toggleSort(prev, key));

  // Summary KPIs across filtered set
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
        filters={[
          {
            label: 'Vendor',
            value: vendorFilter,
            onChange: setVendorFilter,
            options: vendors.map((v) => ({ value: v.id, label: v.label })),
          },
          {
            label: 'Status',
            value: statusFilter,
            onChange: setStatusFilter,
            options: poStatusValues.map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            })),
          },
        ]}
        onClear={() => {
          setSearch('');
          setStatusFilter('');
          setVendorFilter('');
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No purchase orders match those filters.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortableHeader label="Number" sortKey="number" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Vendor" sortKey="vendor" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Project" sortKey="project" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Status" sortKey="status" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Order date" sortKey="order" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Expected"
                    sortKey="expected"
                    sort={sort}
                    onSort={onSort}
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader
                    label="Subtotal"
                    sortKey="subtotal"
                    sort={sort}
                    onSort={onSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader
                    label="Total"
                    sortKey="total"
                    sort={sort}
                    onSort={onSort}
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
