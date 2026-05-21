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
import { TYPE_LABEL, TYPE_TONE } from '@/modules/vendors/schema';

export type VendorRow = {
  id: string;
  name: string;
  isSubcontractor: boolean;
  primaryContactName: string | null;
  email: string | null;
  phone: string | null;
  defaultTerms: string | null;
  openPOCount: number;
  committed: number;
};

type FilterKey = 'type';

export function VendorsListClient({ vendors }: { vendors: VendorRow[] }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    type: new Set(),
  });
  const [sort, setSort] = useState<SortState>(null);

  const typeOptions = useMemo<FilterOption[]>(() => {
    const hasSubs = vendors.some((v) => v.isSubcontractor);
    const hasSuppliers = vendors.some((v) => !v.isSubcontractor);
    const opts: FilterOption[] = [];
    if (hasSuppliers) opts.push({ value: 'supplier', label: 'Supplier' });
    if (hasSubs) opts.push({ value: 'subcontractor', label: 'Subcontractor' });
    return opts;
  }, [vendors]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (set: Set<string>, value: string) =>
      set.size === 0 || set.has(value);
    let rows = vendors.filter((v) => {
      const matchesSearch =
        q === '' ||
        v.name.toLowerCase().includes(q) ||
        (v.primaryContactName ?? '').toLowerCase().includes(q) ||
        (v.email ?? '').toLowerCase().includes(q);
      const type = v.isSubcontractor ? 'subcontractor' : 'supplier';
      return matchesSearch && matches(filters.type, type);
    });

    if (sort) {
      const get = (v: VendorRow): string | number | null => {
        switch (sort.key) {
          case 'name':
            return v.name;
          case 'type':
            return v.isSubcontractor ? 'subcontractor' : 'supplier';
          case 'contact':
            return v.primaryContactName;
          case 'open':
            return v.openPOCount;
          case 'committed':
            return v.committed;
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
  }, [vendors, search, filters, sort]);

  const setFilter = (key: FilterKey) => (next: Set<string>) =>
    setFilters((prev) => ({ ...prev, [key]: next }));

  return (
    <div className="space-y-4">
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, contact, or email…"
        onClear={() => {
          setSearch('');
          setFilters({ type: new Set() });
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">
            {vendors.length === 0
              ? 'No vendors yet.'
              : 'No vendors match those filters.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <ColumnHeader
                    label="Company"
                    sortKey="name"
                    sort={sort}
                    onSortChange={setSort}
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
                    label="Contact"
                    sortKey="contact"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead className="text-right">
                  <ColumnHeader
                    label="Open POs"
                    sortKey="open"
                    sort={sort}
                    onSortChange={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader
                    label="Committed"
                    sortKey="committed"
                    sort={sort}
                    onSortChange={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((v) => {
                const type = v.isSubcontractor ? 'subcontractor' : 'supplier';
                return (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium text-slate-900">{v.name}</TableCell>
                    <TableCell>
                      <Badge tone={TYPE_TONE[type]}>{TYPE_LABEL[type]}</Badge>
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {v.primaryContactName ?? '—'}
                    </TableCell>
                    <TableCell className="text-slate-600">{v.email ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">{v.phone ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">
                      {v.defaultTerms ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {v.openPOCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(v.committed)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/vendors/${v.id}`}>
                        <Button size="sm" variant="outline">
                          View Vendor
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
