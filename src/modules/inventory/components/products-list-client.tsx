'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ListToolbar } from '@/components/ui/list-toolbar';
import {
  SortableHeader,
  compareValues,
  toggleSort,
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

export type ProductRow = {
  id: string;
  name: string;
  category: string | null;
  sku: string | null;
  unit: string | null;
  defaultCost: number;
  isTaxable: boolean;
  archived: boolean;
  // Phase 6.3: on-hand quantity rolled up from inventory_movements.
  // 0 when there have been no movements (item still in catalog but never
  // received or adjusted).
  onHand: number;
  /** Set by hand on the product, else the vendor of the latest PO it was
   *  received (or ordered) on. */
  supplierName: string | null;
  supplierSource: 'set' | 'po' | null;
  supplierPoNumber: string | null;
};

const NONE = '__none__';

const distinct = (values: Array<string | null>) =>
  Array.from(new Set(values.filter((v): v is string => Boolean(v && v.trim()))))
    .sort((a, b) => a.localeCompare(b))
    .map((v) => ({ value: v, label: v }));

export function ProductsListClient({ products }: { products: ProductRow[] }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [supplier, setSupplier] = useState('');
  const [unit, setUnit] = useState('');
  const [stock, setStock] = useState('');
  const [skuQuery, setSkuQuery] = useState('');
  const [costMin, setCostMin] = useState('');
  const [costMax, setCostMax] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const onSort = (key: string) => setSort((prev) => toggleSort(prev, key));

  const categoryOptions = useMemo(
    () => distinct(products.map((p) => p.category)),
    [products],
  );
  const supplierOptions = useMemo(
    () => [
      ...distinct(products.map((p) => p.supplierName)),
      { value: NONE, label: '(no supplier)' },
    ],
    [products],
  );
  const unitOptions = useMemo(() => distinct(products.map((p) => p.unit)), [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const skuQ = skuQuery.trim().toLowerCase();
    const min = costMin.trim() === '' ? null : Number(costMin);
    const max = costMax.trim() === '' ? null : Number(costMax);
    const rows = products.filter((p) => {
      if (!showArchived && p.archived) return false;
      if (category !== '' && (p.category ?? '') !== category) return false;
      if (supplier === NONE ? p.supplierName : supplier !== '' && p.supplierName !== supplier)
        return false;
      if (unit !== '' && (p.unit ?? '') !== unit) return false;
      if (stock === 'in' && !(p.onHand > 0)) return false;
      if (stock === 'zero' && p.onHand !== 0) return false;
      if (stock === 'negative' && !(p.onHand < 0)) return false;
      if (skuQ === '__none' ? p.sku : skuQ !== '' && !(p.sku ?? '').toLowerCase().includes(skuQ))
        return false;
      if (min !== null && Number.isFinite(min) && p.defaultCost < min) return false;
      if (max !== null && Number.isFinite(max) && p.defaultCost > max) return false;
      if (q === '') return true;
      const hay =
        `${p.name} ${p.sku ?? ''} ${p.category ?? ''} ${p.unit ?? ''} ${p.supplierName ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
    if (!sort) return rows;
    const val = (p: ProductRow): string | number | null => {
      switch (sort.key) {
        case 'category':
          return p.category;
        case 'sku':
          return p.sku;
        case 'unit':
          return p.unit;
        case 'supplier':
          return p.supplierName;
        case 'onHand':
          return p.onHand;
        case 'cost':
          return p.defaultCost;
        case 'tax':
          return p.isTaxable ? 'Taxable' : 'Exempt';
        default:
          return p.name;
      }
    };
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      // Blanks always sink to the bottom, whichever direction.
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return compareValues(va, vb) * dir;
    });
  }, [
    products,
    search,
    category,
    supplier,
    unit,
    stock,
    skuQuery,
    costMin,
    costMax,
    showArchived,
    sort,
  ]);

  const head = (label: string, key: string, align: 'left' | 'right' = 'left') => (
    <SortableHeader label={label} sortKey={key} sort={sort} onSort={onSort} align={align} />
  );

  return (
    <div className="space-y-4">
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search name, SKU, category, supplier…"
        filters={[
          ...(categoryOptions.length > 0
            ? [{ label: 'Category', value: category, onChange: setCategory, options: categoryOptions }]
            : []),
          { label: 'Supplier', value: supplier, onChange: setSupplier, options: supplierOptions },
          ...(unitOptions.length > 0
            ? [{ label: 'Unit', value: unit, onChange: setUnit, options: unitOptions }]
            : []),
          {
            label: 'On hand',
            value: stock,
            onChange: setStock,
            options: [
              { value: 'in', label: 'In stock (> 0)' },
              { value: 'zero', label: 'None on hand (0)' },
              { value: 'negative', label: 'Negative' },
            ],
          },
        ]}
        onClear={() => {
          setSearch('');
          setCategory('');
          setSupplier('');
          setUnit('');
          setStock('');
          setSkuQuery('');
          setCostMin('');
          setCostMax('');
        }}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
        <label className="flex items-center gap-2">
          SKU
          <Input
            value={skuQuery}
            onChange={(e) => setSkuQuery(e.target.value)}
            placeholder="contains…"
            className="h-9 w-36"
          />
        </label>
        <button
          type="button"
          className="text-xs text-blue-700 hover:underline"
          onClick={() => setSkuQuery(skuQuery === '__none' ? '' : '__none')}
        >
          {skuQuery === '__none' ? 'Any SKU' : 'Missing SKU only'}
        </button>
        <label className="flex items-center gap-2">
          Default cost
          <Input
            value={costMin}
            onChange={(e) => setCostMin(e.target.value)}
            inputMode="decimal"
            placeholder="min"
            className="h-9 w-24"
          />
          –
          <Input
            value={costMax}
            onChange={(e) => setCostMax(e.target.value)}
            inputMode="decimal"
            placeholder="max"
            className="h-9 w-24"
          />
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
        <span className="ml-auto text-xs text-slate-500">
          {filtered.length} of {products.filter((p) => showArchived || !p.archived).length}
        </span>
      </div>

      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{head('Name', 'name')}</TableHead>
              <TableHead>{head('Category', 'category')}</TableHead>
              <TableHead>{head('SKU', 'sku')}</TableHead>
              <TableHead>{head('Unit', 'unit')}</TableHead>
              <TableHead>{head('Supplier', 'supplier')}</TableHead>
              <TableHead className="text-right">{head('On hand', 'onHand', 'right')}</TableHead>
              <TableHead className="text-right">{head('Default cost', 'cost', 'right')}</TableHead>
              <TableHead>{head('Tax', 'tax')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-slate-500 py-8">
                  No products match your filters.
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
                  <TableCell className="text-slate-600">
                    {p.supplierName ?? '—'}
                    {p.supplierSource === 'po' && p.supplierPoNumber && (
                      <span
                        className="ml-1 text-[11px] text-slate-400"
                        title="From the latest PO this product was received on — set it on the product to override"
                      >
                        ({p.supplierPoNumber})
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      p.onHand < 0
                        ? 'text-red-700 font-medium'
                        : p.onHand === 0
                          ? 'text-slate-400'
                          : 'text-slate-900'
                    }`}
                  >
                    {p.onHand.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </TableCell>
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
