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
  type SubPaymentStatus,
} from '@/modules/subcontractor-payments/schema';

export type SubPaymentRow = {
  id: string;
  vendorId: string;
  vendorName: string;
  projectId: string | null;
  projectName: string;
  workPeriodStart: string;
  workPeriodEnd: string;
  scopeDescription: string;
  grossAmount: string;
  retainagePercent: string;
  retainageHeld: string;
  netPaid: string;
  paidDate: string | null;
  status: SubPaymentStatus;
};

type FilterKey = 'vendor' | 'project' | 'status';

export function SubPaymentsListClient({
  rows,
  allowEdit,
}: {
  rows: SubPaymentRow[];
  allowEdit: boolean;
}) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    vendor: new Set(),
    project: new Set(),
    status: new Set(),
  });
  const [sort, setSort] = useState<SortState>(null);

  const vendorOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.vendorId, r.vendorName);
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [rows]);

  const projectOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(rows.map((r) => r.projectName));
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
        r.vendorName.toLowerCase().includes(q) ||
        r.projectName.toLowerCase().includes(q) ||
        r.scopeDescription.toLowerCase().includes(q);
      return (
        matchesSearch &&
        matches(filters.vendor, r.vendorId) &&
        matches(filters.project, r.projectName) &&
        matches(filters.status, r.status)
      );
    });

    if (sort) {
      const get = (r: SubPaymentRow): string | number | null => {
        switch (sort.key) {
          case 'vendor':
            return r.vendorName;
          case 'project':
            return r.projectName;
          case 'period':
            return r.workPeriodStart;
          case 'gross':
            return Number(r.grossAmount);
          case 'retainage':
            return Number(r.retainageHeld);
          case 'net':
            return Number(r.netPaid);
          case 'paidDate':
            return r.paidDate;
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

  // Aggregate stats across the filtered set.
  const totals = filtered.reduce(
    (acc, r) => {
      if (r.status === 'void') return acc;
      acc.gross += Number(r.grossAmount);
      acc.retainage += Number(r.retainageHeld);
      acc.net += Number(r.netPaid);
      return acc;
    },
    { gross: 0, retainage: 0, net: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Gross billed" value={formatMoney(totals.gross)} />
        <Stat
          label="Retainage held"
          value={formatMoney(totals.retainage)}
          accent={totals.retainage > 0 ? 'amber' : undefined}
        />
        <Stat
          label="Net paid"
          value={formatMoney(totals.net)}
          accent="emerald"
        />
      </div>

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by vendor, project, or scope…"
        onClear={() => {
          setSearch('');
          setFilters({ vendor: new Set(), project: new Set(), status: new Set() });
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">
            {rows.length === 0
              ? 'No subcontractor payments yet.'
              : 'No payments match those filters.'}
          </p>
          {allowEdit && rows.length === 0 && (
            <div className="mt-4 inline-flex">
              <Link href="/payroll/subcontractor-payments/new">
                <Button>Add subcontractor payment</Button>
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
                    label="Vendor"
                    sortKey="vendor"
                    sort={sort}
                    onSortChange={setSort}
                    filterOptions={vendorOptions}
                    filterValues={filters.vendor}
                    onFilterChange={setFilter('vendor')}
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
                <TableHead>Scope</TableHead>
                <TableHead>
                  <ColumnHeader
                    label="Work period"
                    sortKey="period"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader
                    label="Gross"
                    sortKey="gross"
                    sort={sort}
                    onSortChange={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader
                    label="Retainage held"
                    sortKey="retainage"
                    sort={sort}
                    onSortChange={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader
                    label="Net paid"
                    sortKey="net"
                    sort={sort}
                    onSortChange={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead>
                  <ColumnHeader
                    label="Paid date"
                    sortKey="paidDate"
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
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const isVoid = r.status === 'void';
                const heldPct = Number(r.retainagePercent);
                return (
                  <TableRow key={r.id} className={isVoid ? 'opacity-60' : ''}>
                    <TableCell className="font-medium text-slate-900">
                      {r.vendorName}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {r.projectName}
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs max-w-[260px]">
                      <span className="line-clamp-2">{r.scopeDescription}</span>
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs whitespace-nowrap">
                      {r.workPeriodStart} → {r.workPeriodEnd}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(r.grossAmount)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        Number(r.retainageHeld) > 0
                          ? 'text-amber-700'
                          : 'text-slate-400'
                      }`}
                    >
                      {formatMoney(r.retainageHeld)}
                      {heldPct > 0 && (
                        <div className="text-[11px] font-normal text-slate-500">
                          {formatPercent(heldPct, 2)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700 font-medium">
                      {formatMoney(r.netPaid)}
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs">
                      {r.paidDate ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[r.status]}>
                        {STATUS_LABEL[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {allowEdit && (
                        <Link
                          href={`/payroll/subcontractor-payments/${r.id}/edit`}
                        >
                          <Button size="sm" variant="outline">
                            Edit
                          </Button>
                        </Link>
                      )}
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

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'amber' | 'emerald';
}) {
  const valueClass =
    accent === 'amber'
      ? 'text-amber-700'
      : accent === 'emerald'
        ? 'text-emerald-700'
        : 'text-slate-900';
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}
