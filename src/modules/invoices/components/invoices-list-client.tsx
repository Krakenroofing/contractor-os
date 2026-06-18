'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ColumnHeader,
  type FilterOption,
} from '@/components/ui/column-header';
import { Input } from '@/components/ui/input';
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
  datePaid: string | null;
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
  | 'datePaid'
  | 'total'
  | 'balance';

type FilterKey = 'project' | 'customer' | 'type' | 'status';

// Quarter helpers — kept local so this list isn't coupled to dashboard.ts.
function quarterKeyForIsoDate(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 'unknown';
  const q = Math.min(4, Math.max(1, Math.ceil(m / 3)));
  return `${y}-Q${q}`;
}

function quarterLabelFromKey(key: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return 'Unknown';
  return `Q${m[2]} ${m[1]}`;
}

export function InvoicesListClient({
  rows,
  allowCreate,
}: {
  rows: InvoiceListRow[];
  allowCreate: boolean;
}) {
  const [search, setSearch] = useState('');
  // Voided invoices are hidden by default — they're dead obligations and
  // never count toward any total. They stay in the DB for audit, so a
  // toggle reveals them (rendered faded) when someone needs to look.
  const [showVoided, setShowVoided] = useState(false);
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
  // Which quarter sections are collapsed. Default = all expanded so the
  // accountant sees everything; clicking a quarter header toggles it.
  const [collapsedQuarters, setCollapsedQuarters] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleQuarter = (key: string) =>
    setCollapsedQuarters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const expandAll = () => setCollapsedQuarters(new Set());
  const collapseAll = () => {
    // Collapse every quarter that's currently present in the filtered set.
    setCollapsedQuarters(new Set(quarters.map((q) => q.key)));
  };

  // Count of voided invoices in the full set (for the toggle label) and
  // the base set the rest of the table works from — voids excluded unless
  // the toggle is on. Everything downstream (options, filters, quarter
  // totals, counts) keys off baseRows so hidden voids never sneak into a
  // total or a dropdown.
  const voidCount = useMemo(
    () => rows.filter((r) => r.status === 'void').length,
    [rows],
  );
  const baseRows = useMemo(
    () => (showVoided ? rows : rows.filter((r) => r.status !== 'void')),
    [rows, showVoided],
  );

  const projectOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    for (const r of baseRows) map.set(r.projectId, r.projectName);
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [baseRows]);

  const customerOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    for (const r of baseRows) map.set(r.customerId ?? '', r.customerName);
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [baseRows]);

  const typeOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(baseRows.map((r) => r.billingType));
    return Array.from(present)
      .sort()
      .map((value) => ({ value, label: BILLING_TYPE_LABEL[value] }));
  }, [baseRows]);

  const statusOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(baseRows.map((r) => r.status));
    return Array.from(present)
      .sort()
      .map((value) => ({ value, label: STATUS_LABEL[value] }));
  }, [baseRows]);

  const filtered = useMemo(() => {
    const matches = (set: Set<string>, value: string) =>
      set.size === 0 || set.has(value);
    const q = search.trim().toLowerCase();
    const matchesSearch = (r: InvoiceListRow) => {
      if (q === '') return true;
      const haystack = [
        r.number,
        r.projectName,
        r.customerName,
        STATUS_LABEL[r.status],
        BILLING_TYPE_LABEL[r.billingType],
        r.invoiceDate,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    };
    let out = baseRows.filter(
      (r) =>
        matches(filters.project, r.projectId) &&
        matches(filters.customer, r.customerId ?? '') &&
        matches(filters.type, r.billingType) &&
        matches(filters.status, r.status) &&
        matchesSearch(r),
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
          case 'datePaid':
            return r.datePaid;
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
  }, [baseRows, filters, sort, search]);

  // Group the filtered set by quarter (of invoiceDate). Newest quarter
  // first so the accountant sees the current period at the top. Inside
  // each quarter, rows respect the active sort; if no sort is set, fall
  // back to newest invoice date first within the quarter.
  const quarters = useMemo(() => {
    const map = new Map<string, InvoiceListRow[]>();
    for (const r of filtered) {
      const key = quarterKeyForIsoDate(r.invoiceDate);
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    const entries = Array.from(map.entries());
    // If the user hasn't picked a sort, default each bucket to most
    // recent invoiceDate first (typical accountant scan order).
    if (!sort) {
      for (const [, list] of entries) {
        list.sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
      }
    }
    entries.sort(([a], [b]) => b.localeCompare(a)); // YYYY-Qn sorts naturally desc
    return entries.map(([key, list]) => {
      const total = list.reduce((acc, r) => acc + (r.status === 'void' ? 0 : r.total), 0);
      const balance = list.reduce(
        (acc, r) => acc + (r.status === 'void' ? 0 : r.balance),
        0,
      );
      return {
        key,
        label: quarterLabelFromKey(key),
        rows: list,
        count: list.length,
        total,
        balance,
      };
    });
  }, [filtered, sort]);

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

  const totalFiltered = filtered.length;
  const allCollapsed = quarters.every((q) => collapsedQuarters.has(q.key));

  return (
    <div className="space-y-3">
      {/* ----- Search + section controls ----- */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px] max-w-md">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice #, project, customer, status…"
            aria-label="Search invoices"
          />
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-500">
            {totalFiltered} of {baseRows.length} invoice
            {baseRows.length === 1 ? '' : 's'}
            {quarters.length > 0 && (
              <>
                {' '}· {quarters.length} quarter
                {quarters.length === 1 ? '' : 's'}
              </>
            )}
          </span>
          {voidCount > 0 && (
            <label className="flex items-center gap-1.5 text-slate-500 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={showVoided}
                onChange={(e) => setShowVoided(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              Show {voidCount} voided
            </label>
          )}
          {quarters.length > 1 && (
            <button
              type="button"
              onClick={allCollapsed ? expandAll : collapseAll}
              className="text-blue-600 hover:underline"
            >
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
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
            <TableHead>
              <ColumnHeader
                label="Date paid"
                sortKey="datePaid"
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
              <TableCell colSpan={11} className="py-12 text-center text-slate-500">
                No invoices match those filters.
              </TableCell>
            </TableRow>
          ) : (
            quarters.flatMap((q) => {
              const collapsed = collapsedQuarters.has(q.key);
              const headerRow = (
                <TableRow
                  key={`hdr-${q.key}`}
                  className="bg-slate-50 hover:bg-slate-100 cursor-pointer border-t-2 border-slate-200"
                  onClick={() => toggleQuarter(q.key)}
                >
                  <TableCell
                    colSpan={8}
                    className="font-semibold text-slate-900 text-sm py-2.5"
                  >
                    <span className="inline-block w-4 text-slate-500">
                      {collapsed ? '▸' : '▾'}
                    </span>
                    {q.label}
                    <span className="ml-3 font-normal text-xs text-slate-500">
                      {q.count} invoice{q.count === 1 ? '' : 's'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-semibold">
                    {formatMoney(q.total)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums text-sm font-semibold ${
                      q.balance > 0 ? 'text-amber-700' : 'text-emerald-700'
                    }`}
                  >
                    {formatMoney(q.balance)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              );
              if (collapsed) return [headerRow];
              return [
                headerRow,
                ...q.rows.map((r) => {
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
                  <TableCell
                    className={
                      r.datePaid ? 'text-emerald-700' : 'text-slate-400'
                    }
                  >
                    {r.datePaid ?? '—'}
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
                }),
              ];
            })
          )}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
