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

export function CustomersListClient({ customers }: { customers: CustomerRow[] }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = customers.filter((c) => {
      const matchesSearch =
        q === '' ||
        c.name.toLowerCase().includes(q) ||
        (c.primaryContactName ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q);
      const matchesType = !typeFilter || c.customerType === typeFilter;
      return matchesSearch && matchesType;
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
  }, [customers, search, typeFilter, sort]);

  const onSort = (key: string) => setSort((prev) => toggleSort(prev, key));

  return (
    <div className="space-y-4">
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by company, contact, or email…"
        filters={[
          {
            label: 'Type',
            value: typeFilter,
            onChange: setTypeFilter,
            options: [
              { value: 'residential', label: 'Residential' },
              { value: 'commercial', label: 'Commercial' },
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
          <p className="text-slate-600">No customers match those filters.</p>
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
                <TableHead>
                  <SortableHeader label="Email" sortKey="email" sort={sort} onSort={onSort} />
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
