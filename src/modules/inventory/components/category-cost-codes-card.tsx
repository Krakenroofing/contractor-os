'use client';

// Category defaults: the cost code and accounting category a product in
// this category posts to on POs and bills. A product's own defaults win.
// PO lines coded differently get a ⚠ so a mis-coded order is caught before
// it hits job costing.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { setCategoryDefaultsAction } from '../vendor-number-actions';

export function CategoryCostCodesCard({
  categories,
  costCodes,
  accounts,
  canEdit,
}: {
  categories: Array<{
    category: string;
    costCodeId: string | null;
    accountId: string | null;
    count: number;
  }>;
  costCodes: Array<{ id: string; label: string }>;
  accounts: Array<{ id: string; label: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const setCount = categories.filter((c) => c.costCodeId || c.accountId).length;

  function save(category: string, patch: { costCodeId?: string | null; accountId?: string | null }) {
    setSaved(null);
    start(async () => {
      const res = await setCategoryDefaultsAction({ category, ...patch });
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
          <CardTitle>Category defaults</CardTitle>
          <span className="text-xs text-slate-500">
            {setCount} of {categories.length} set · {open ? 'hide' : 'show'}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2 text-sm">
          <p className="text-xs text-slate-500">
            The cost code and accounting category a PO line fills in when you
            pick a product in this category (a product&apos;s own defaults
            win; with neither, the vendor&apos;s default category applies).
            PO lines coded differently show a ⚠.
          </p>
          <div className="divide-y divide-slate-100">
            {categories.map((c) => (
              <div
                key={c.category}
                className="flex flex-wrap items-center justify-between gap-3 py-1.5"
              >
                <span className="text-slate-700">
                  {c.category}{' '}
                  <span className="text-xs text-slate-400">
                    ({c.count} product{c.count === 1 ? '' : 's'})
                  </span>
                  {saved === c.category && (
                    <span className="ml-2 text-xs text-emerald-700">✓ Saved</span>
                  )}
                </span>
                <span className="flex flex-wrap gap-2">
                  <select
                    defaultValue={c.costCodeId ?? ''}
                    disabled={!canEdit || pending}
                    onChange={(e) =>
                      save(c.category, { costCodeId: e.target.value || null })
                    }
                    className="h-9 w-64 rounded-md border border-slate-300 bg-white px-2 text-sm"
                    aria-label="Default cost code"
                  >
                    <option value="">— No default cost code —</option>
                    {costCodes.map((cc) => (
                      <option key={cc.id} value={cc.id}>
                        {cc.label}
                      </option>
                    ))}
                  </select>
                  <select
                    defaultValue={c.accountId ?? ''}
                    disabled={!canEdit || pending}
                    onChange={(e) =>
                      save(c.category, { accountId: e.target.value || null })
                    }
                    className="h-9 w-64 rounded-md border border-slate-300 bg-white px-2 text-sm"
                    aria-label="Default accounting category"
                  >
                    <option value="">— Vendor&apos;s category —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
