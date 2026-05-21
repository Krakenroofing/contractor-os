'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { formatMoney, parseMoney } from '@/lib/money';
import type { Project } from '@/db/schema';

const STATUS_TONE: Record<
  Project['status'],
  'slate' | 'blue' | 'amber' | 'green' | 'red'
> = {
  lead: 'slate',
  estimating: 'blue',
  won: 'green',
  in_progress: 'amber',
  closed: 'green',
  lost: 'red',
};

const STATUS_LABEL: Record<Project['status'], string> = {
  lead: 'Lead',
  estimating: 'Estimating',
  won: 'Won',
  in_progress: 'In Progress',
  closed: 'Closed',
  lost: 'Lost',
};

export type ProjectRow = {
  id: string;
  name: string;
  status: Project['status'];
  customerName: string;
  contractValue: string;
  currentBudget: string;
  totalChangeOrders: string;
};

type FilterKey = 'customer' | 'status';

export function ProjectsListClient({
  projects,
  canCreate = true,
}: {
  projects: ProjectRow[];
  canCreate?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    customer: new Set(),
    status: new Set(),
  });
  const [sort, setSort] = useState<SortState>(null);

  const customerOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(projects.map((p) => p.customerName));
    return Array.from(present)
      .sort()
      .map((name) => ({ value: name, label: name }));
  }, [projects]);

  const statusOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(projects.map((p) => p.status));
    return Array.from(present)
      .sort()
      .map((s) => ({ value: s, label: STATUS_LABEL[s] }));
  }, [projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (set: Set<string>, value: string) =>
      set.size === 0 || set.has(value);
    let rows = projects.filter((p) => {
      const matchesSearch =
        q === '' ||
        p.name.toLowerCase().includes(q) ||
        p.customerName.toLowerCase().includes(q);
      return (
        matchesSearch &&
        matches(filters.customer, p.customerName) &&
        matches(filters.status, p.status)
      );
    });

    if (sort) {
      const get = (p: ProjectRow): string | number | null => {
        switch (sort.key) {
          case 'name':
            return p.name;
          case 'customer':
            return p.customerName;
          case 'status':
            return p.status;
          case 'contract':
            return parseMoney(p.contractValue);
          case 'profit':
            return parseMoney(p.contractValue) - parseMoney(p.currentBudget);
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
  }, [projects, search, filters, sort]);

  const setFilter = (key: FilterKey) => (next: Set<string>) =>
    setFilters((prev) => ({ ...prev, [key]: next }));

  // Summary KPIs across filtered set so they reflect what the user sees
  const totalContract = filtered.reduce(
    (a, p) => a + parseMoney(p.contractValue),
    0,
  );
  const activeStatuses: Project['status'][] = ['won', 'in_progress', 'estimating'];
  const activeJobs = filtered.filter((p) => activeStatuses.includes(p.status)).length;
  const totalProjectedProfit = filtered.reduce(
    (a, p) => a + (parseMoney(p.contractValue) - parseMoney(p.currentBudget)),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPI label="Total contract value" value={formatMoney(totalContract)} />
        <KPI
          label="Active jobs"
          value={String(activeJobs)}
          sub="estimating · won · in progress"
        />
        <KPI
          label="Total projected profit"
          value={formatMoney(totalProjectedProfit)}
          valueClassName={
            totalProjectedProfit < 0
              ? 'text-red-600'
              : totalProjectedProfit > 0
                ? 'text-emerald-700'
                : 'text-slate-900'
          }
        />
      </div>

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name or customer…"
        onClear={() => {
          setSearch('');
          setFilters({ customer: new Set(), status: new Set() });
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">
            {projects.length === 0
              ? 'No projects yet.'
              : 'No projects match those filters.'}
          </p>
          {canCreate && projects.length === 0 && (
            <div className="mt-4 inline-flex">
              <Link href="/projects/new">
                <Button>New Project</Button>
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <ColumnHeader
                    label="Name"
                    sortKey="name"
                    sort={sort}
                    onSortChange={setSort}
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
                <TableHead className="text-right">
                  <ColumnHeader
                    label="Contract"
                    sortKey="contract"
                    sort={sort}
                    onSortChange={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader
                    label="Projected GP"
                    sortKey="profit"
                    sort={sort}
                    onSortChange={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const profit = parseMoney(p.contractValue) - parseMoney(p.currentBudget);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-slate-900">{p.name}</TableCell>
                    <TableCell className="text-slate-600">{p.customerName}</TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(p.contractValue)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        profit < 0
                          ? 'text-red-600'
                          : profit > 0
                            ? 'text-emerald-700'
                            : 'text-slate-900'
                      }`}
                    >
                      {formatMoney(profit)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/projects/${p.id}`}>
                        <Button size="sm" variant="outline">
                          View Project
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
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
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            valueClassName ?? 'text-slate-900'
          }`}
        >
          {value}
        </p>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </CardContent>
    </Card>
  );
}
