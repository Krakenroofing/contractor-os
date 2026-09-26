'use client';

// Default cost code per product category (roadmap P4). A product's own
// default wins; otherwise its category's. PO lines coded differently get a
// ⚠ so a mis-coded shingle order is caught before it hits job costing.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { setCategoryCostCodeAction } from '../vendor-number-actions';

export function CategoryCostCodesCard({
  categories,
  costCodes,
  canEdit,
}: {
  categories: Array<{ category: string; costCodeId: string | null; count: number }>;
  costCodes: Array<{ id: string; label: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const setCount = categories.filter((c) => c.costCodeId).length;

  function save(category: string, costCodeId: string) {
    setSaved(null);
    start(async () => {
      const res = await setCategoryCostCodeAction({
        category,
        costCodeId: costCodeId || null,
      });
      if (res.ok) setSaved(category);
      router.refresh();
    });
  }

  if (categories.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between text-left"
        >
          <CardTitle>Default cost code by category</CardTitle>
          <span className="text-xs text-slate-500">
            {setCount} of {categories.length} set · {open ? 'hide' : 'show'}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2 text-sm">
          <p className="text-xs text-slate-500">
            Used when a product has no default of its own. Purchase-order lines
            coded to a different cost code show a ⚠ on the PO.
          </p>
          <div className="divide-y divide-slate-100">
            {categories.map((c) => (
              <div key={c.category} className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-slate-700">
                  {c.category}{' '}
                  <span className="text-xs text-slate-400">
                    ({c.count} product{c.count === 1 ? '' : 's'})
                  </span>
                  {saved === c.category && (
                    <span className="ml-2 text-xs text-emerald-700">✓ Saved</span>
                  )}
                </span>
                <select
                  defaultValue={c.costCodeId ?? ''}
                  disabled={!canEdit || pending}
                  onChange={(e) => save(c.category, e.target.value)}
                  className="h-9 w-72 rounded-md border border-slate-300 bg-white px-2 text-sm"
                >
                  <option value="">— No default —</option>
                  {costCodes.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
