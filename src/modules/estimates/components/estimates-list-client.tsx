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
  estimateStatusValues,
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

export function EstimatesListClient({
  estimates,
  projects,
}: {
  estimates: EstimateRow[];
  projects: { id: string; label: string }[];
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [sort, setSort] = useState<SortState>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = estimates.filter((e) => {
      const matchesSearch =
        q === '' ||
        e.number.toLowerCase().includes(q) ||
        e.projectName.toLowerCase().includes(q) ||
        e.customerName.toLowerCase().includes(q);
      const matchesStatus = !statusFilter || e.status === statusFilter;
      const matchesProject = !projectFilter || e.projectId === projectFilter;
      return matchesSearch && matchesStatus && matchesProject;
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
  }, [estimates, search, statusFilter, projectFilter, sort]);

  const onSort = (key: string) => setSort((prev) => toggleSort(prev, key));

  return (
    <div className="space-y-4">
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by number, project, or customer…"
        filters={[
          {
            label: 'Project',
            value: projectFilter,
            onChange: setProjectFilter,
            options: projects.map((p) => ({ value: p.id, label: p.label })),
          },
          {
            label: 'Status',
            value: statusFilter,
            onChange: setStatusFilter,
            options: estimateStatusValues.map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            })),
          },
        ]}
        onClear={() => {
          setSearch('');
          setStatusFilter('');
          setProjectFilter('');
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No estimates match those filters.</p>
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
                <TableHead>
                  <SortableHeader label="Status" sortKey="status" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Created" sortKey="created" sort={sort} onSort={onSort} />
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
