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
import {
  EMPLOYMENT_TYPE_LABEL,
  EMPLOYMENT_TYPE_TONE,
  type EmploymentType,
} from '@/modules/employees/schema';

export type EmployeeRow = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  nibNumber: string | null;
  email: string | null;
  phone: string | null;
  employmentType: EmploymentType;
  payRate: string;
  hireDate: string | null;
  active: boolean;
  nibExempt: boolean;
};

type FilterKey = 'employmentType' | 'active';

export function EmployeesListClient({
  employees,
  allowCreate,
}: {
  employees: EmployeeRow[];
  allowCreate: boolean;
}) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    employmentType: new Set(),
    active: new Set(),
  });
  const [sort, setSort] = useState<SortState>(null);

  const employmentTypeOptions = useMemo<FilterOption[]>(() => {
    const present = new Set(employees.map((e) => e.employmentType));
    return Array.from(present)
      .sort()
      .map((t) => ({ value: t, label: EMPLOYMENT_TYPE_LABEL[t] }));
  }, [employees]);

  const activeOptions = useMemo<FilterOption[]>(() => {
    const hasActive = employees.some((e) => e.active);
    const hasInactive = employees.some((e) => !e.active);
    const opts: FilterOption[] = [];
    if (hasActive) opts.push({ value: 'active', label: 'Active' });
    if (hasInactive) opts.push({ value: 'inactive', label: 'Inactive' });
    return opts;
  }, [employees]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (set: Set<string>, value: string) =>
      set.size === 0 || set.has(value);
    let rows = employees.filter((e) => {
      const matchesSearch =
        q === '' ||
        e.fullName.toLowerCase().includes(q) ||
        (e.nibNumber ?? '').toLowerCase().includes(q) ||
        (e.email ?? '').toLowerCase().includes(q);
      const activeFlag = e.active ? 'active' : 'inactive';
      return (
        matchesSearch &&
        matches(filters.employmentType, e.employmentType) &&
        matches(filters.active, activeFlag)
      );
    });

    if (sort) {
      const get = (e: EmployeeRow): string | number | null => {
        switch (sort.key) {
          case 'name':
            return `${e.lastName} ${e.firstName}`.toLowerCase();
          case 'nibNumber':
            return e.nibNumber;
          case 'employmentType':
            return e.employmentType;
          case 'payRate':
            return Number(e.payRate);
          case 'hireDate':
            return e.hireDate;
          case 'active':
            return e.active ? 'active' : 'inactive';
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
  }, [employees, search, filters, sort]);

  const setFilter = (key: FilterKey) => (next: Set<string>) =>
    setFilters((prev) => ({ ...prev, [key]: next }));

  return (
    <div className="space-y-4">
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, NIB number, or email…"
        onClear={() => {
          setSearch('');
          setFilters({ employmentType: new Set(), active: new Set() });
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">
            {employees.length === 0
              ? 'No employees yet.'
              : 'No employees match those filters.'}
          </p>
          {allowCreate && employees.length === 0 && (
            <div className="mt-4 inline-flex">
              <Link href="/employees/new">
                <Button>Add Employee</Button>
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
                    label="NIB #"
                    sortKey="nibNumber"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </TableHead>
                <TableHead>
                  <ColumnHeader
                    label="Type"
                    sortKey="employmentType"
                    sort={sort}
                    onSortChange={setSort}
                    filterOptions={employmentTypeOptions}
                    filterValues={filters.employmentType}
                    onFilterChange={setFilter('employmentType')}
                  />
                </TableHead>
                <TableHead className="text-right">
                  <ColumnHeader
                    label="Pay rate"
                    sortKey="payRate"
                    sort={sort}
                    onSortChange={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead>
                  <ColumnHeader
                    label="Hired"
                    sortKey="hireDate"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </TableHead>
                <TableHead>
                  <ColumnHeader
                    label="Status"
                    sortKey="active"
                    sort={sort}
                    onSortChange={setSort}
                    filterOptions={activeOptions}
                    filterValues={filters.active}
                    onFilterChange={setFilter('active')}
                  />
                </TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id} className={e.active ? '' : 'opacity-60'}>
                  <TableCell className="font-medium text-slate-900">
                    {e.fullName}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-700">
                    {e.nibNumber ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge tone={EMPLOYMENT_TYPE_TONE[e.employmentType]}>
                      {EMPLOYMENT_TYPE_LABEL[e.employmentType]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatMoney(e.payRate)}
                    <span className="text-[11px] font-normal text-slate-500">
                      {e.employmentType === 'hourly'
                        ? ' / hr'
                        : e.employmentType === 'salaried'
                          ? ' / wk'
                          : ' / period'}
                    </span>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {e.hireDate ?? '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      {e.active ? (
                        <Badge tone="green">Active</Badge>
                      ) : (
                        <Badge tone="slate">Inactive</Badge>
                      )}
                      {e.nibExempt && <Badge tone="amber">NIB exempt</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/employees/${e.id}`}>
                      <Button size="sm" variant="outline">
                        View
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
