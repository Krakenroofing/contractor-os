'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { ListToolbar } from '@/components/ui/list-toolbar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney } from '@/lib/money';

export type ProductRow = {
  id: string;
  name: string;
  category: string | null;
  sku: string | null;
  unit: string | null;
  defaultCost: number;
  isTaxable: boolean;
  archived: boolean;
};

export function ProductsListClient({ products }: { products: ProductRow[] }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.category && p.category.trim() !== '') set.add(p.category);
    }
    return Array.from(set)
      .sort()
      .map((c) => ({ value: c, label: c }));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!showArchived && p.archived) return false;
      if (category !== '' && (p.category ?? '') !== category) return false;
      if (q === '') return true;
      const hay =
        `${p.name} ${p.sku ?? ''} ${p.category ?? ''} ${p.unit ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [products, search, category, showArchived]);

  return (
    <div className="space-y-4">
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search name, SKU, or category…"
        filters={
          categoryOptions.length > 0
            ? [
                {
                  label: 'Category',
                  value: category,
                  onChange: setCategory,
                  options: categoryOptions,
                },
              ]
            : undefined
        }
        onClear={() => {
          setSearch('');
          setCategory('');
        }}
      />

      <label className="inline-flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Show archived
      </label>

      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Default cost</TableHead>
              <TableHead>Tax</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                  No products match your search.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/inventory/${p.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.archived && (
                      <Badge tone="slate" className="ml-2">
                        Archived
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-600">{p.category ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">{p.sku ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">{p.unit ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(p.defaultCost)}
                  </TableCell>
                  <TableCell>
                    {p.isTaxable ? (
                      <Badge tone="blue">Taxable</Badge>
                    ) : (
                      <Badge tone="slate">Exempt</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
