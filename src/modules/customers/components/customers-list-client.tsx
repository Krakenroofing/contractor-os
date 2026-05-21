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
import type { Customer } from '@/db/schema';

const TYPE_TONE: Record<Customer['customerType'], 'slate' | 'blue'> = {
  residential: 'slate',
  commercial: 'blue',
};

const TYPE_LABEL: Record<Customer['customerType'], string> = {
  residential: 'Residential',
  commercial: 'Commercial',
};

export type CustomerRow = {
  id: string;
  name: string;
  customerType: Customer['customerType'];
  primaryContactName: string | null;
  email: string | null;
  phone: string | null;
};

type FilterKey = 'type';

export function CustomersListClient({ customers }: { customers: CustomerRow[] }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    type: new Set(),
  });
  const [sort, setSort] = useState<SortState>(null);

  const typeOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(customers.map((c) => c.customerType));
    return Array.from(present)
      .sort()
      .map((t) => ({ value: t, label: TYPE_LABEL[t] }));
  }, [customers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (set: Set<string>, value: string) =>
      set.size === 0 || set.has(value);
    let rows = customers.filter((c) => {
      const matchesSearch =
        q === '' ||
        c.name.toLowerCase().includes(q) ||
        (c.primaryContactName ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q);
      return matchesSearch && matches(filters.type, c.customerType);
    });

    if (sort) {
      const get = (c: CustomerRow): string | number | null => {
        switch (sort.key) {
          case 'name':
            return c.name;
          case 'type':
            return c.customerType;
          case 'contact':
            return c.primaryContactName;
          case 'email':
            return c.email;
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
  }, [customers, search, filters, sort]);

  const setFilter = (key: FilterKey) => (next: Set<string>) =>
    setFilters((prev) => ({ ...prev, [key]: next }));

  return (
    <div className="space-y-4">
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by company, contact, or email…"
        onClear={() => {
          setSearch('');
          setFilters({ type: new Set() });
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">
            {customers.length === 0
              ? 'No customers yet.'
              : 'No customers match those filters.'}
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
                <TableHead>
                  <ColumnHeader
                    label="Email"
                    sortKey="email"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-slate-900">{c.name}</TableCell>
                  <TableCell>
                    <Badge tone={TYPE_TONE[c.customerType]}>
                      {TYPE_LABEL[c.customerType]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {c.primaryContactName ?? '—'}
                  </TableCell>
                  <TableCell className="text-slate-600">{c.email ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">{c.phone ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/customers/${c.id}`}>
                      <Button size="sm" variant="outline">
                        View Customer
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
