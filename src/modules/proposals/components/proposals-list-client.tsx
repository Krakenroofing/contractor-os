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
  STATUS_LABEL,
  STATUS_TONE,
  proposalStatusValues,
} from '@/modules/proposals/schema';
import type { Proposal } from '@/db/schema';

export type ProposalRow = {
  id: string;
  number: string;
  projectName: string;
  customerName: string;
  estimateNumber: string;
  status: Proposal['status'];
  proposalDate: string | null;
  expiryDate: string | null;
  total: string;
};

export function ProposalsListClient({ proposals }: { proposals: ProposalRow[] }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState<SortState>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = proposals.filter((p) => {
      const matchesSearch =
        q === '' ||
        p.number.toLowerCase().includes(q) ||
        p.projectName.toLowerCase().includes(q) ||
        p.customerName.toLowerCase().includes(q);
      const matchesStatus = !statusFilter || p.status === statusFilter;
      return matchesSearch && matchesStatus;
    });

    if (sort) {
      const get = (p: ProposalRow): string | number | null => {
        switch (sort.key) {
          case 'number':
            return p.number;
          case 'project':
            return p.projectName;
          case 'customer':
            return p.customerName;
          case 'status':
            return p.status;
          case 'date':
            return p.proposalDate;
          case 'expiry':
            return p.expiryDate;
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
  }, [proposals, search, statusFilter, sort]);

  const onSort = (key: string) => setSort((prev) => toggleSort(prev, key));

  return (
    <div className="space-y-4">
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by number, project, or customer…"
        filters={[
          {
            label: 'Status',
            value: statusFilter,
            onChange: setStatusFilter,
            options: proposalStatusValues.map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            })),
          },
        ]}
        onClear={() => {
          setSearch('');
          setStatusFilter('');
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No proposals match those filters.</p>
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
                  <SortableHeader label="Project" sortKey="project" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Customer"
                    sortKey="customer"
                    sort={sort}
                    onSort={onSort}
                  />
                </TableHead>
                <TableHead>Estimate</TableHead>
                <TableHead>
                  <SortableHeader label="Status" sortKey="status" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Proposal date"
                    sortKey="date"
                    sort={sort}
                    onSort={onSort}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Valid until"
                    sortKey="expiry"
                    sort={sort}
                    onSort={onSort}
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
                    {p.projectName}
                  </TableCell>
                  <TableCell className="text-slate-600">{p.customerName}</TableCell>
                  <TableCell className="font-mono text-xs text-slate-600">
                    {p.estimateNumber}
                  </TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">{p.proposalDate ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">{p.expiryDate ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatMoney(p.total)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/proposals/${p.id}`}>
                      <Button size="sm" variant="outline">
                        View Proposal
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
