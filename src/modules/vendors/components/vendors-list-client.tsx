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

export function VendorsListClient({ vendors }: { vendors: VendorRow[] }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = vendors.filter((v) => {
      const matchesSearch =
        q === '' ||
        v.name.toLowerCase().includes(q) ||
        (v.primaryContactName ?? '').toLowerCase().includes(q) ||
        (v.email ?? '').toLowerCase().includes(q);
      const matchesType =
        !typeFilter ||
        (typeFilter === 'subcontractor' ? v.isSubcontractor : !v.isSubcontractor);
      return matchesSearch && matchesType;
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
  }, [vendors, search, typeFilter, sort]);

  const onSort = (key: string) => setSort((prev) => toggleSort(prev, key));

  return (
    <div className="space-y-4">
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, contact, or email…"
        filters={[
          {
            label: 'Type',
            value: typeFilter,
            onChange: setTypeFilter,
            options: [
              { value: 'supplier', label: 'Supplier' },
              { value: 'subcontractor', label: 'Subcontractor' },
            ],
          },
        ]}
        onClear={() => {
          setSearch('');
          setTypeFilter('');
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No vendors match those filters.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortableHeader label="Company" sortKey="name" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Type" sortKey="type" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Contact" sortKey="contact" sort={sort} onSort={onSort} />
                </TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead className="text-right">
                  <SortableHeader
                    label="Open POs"
                    sortKey="open"
                    sort={sort}
                    onSort={onSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader
                    label="Committed"
                    sortKey="committed"
                    sort={sort}
                    onSort={onSort}
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
