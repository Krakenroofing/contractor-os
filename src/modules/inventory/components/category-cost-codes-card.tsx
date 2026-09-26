'use client';

// Category defaults: the cost code and accounting category a product in
// this category posts to on POs and bills. A product's own defaults win.
// PO lines coded differently get a ⚠ so a mis-coded order is caught before
// it hits job costing.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  addInventoryCategoryAction,
  setCategoryDefaultsAction,
} from '../vendor-number-actions';

export function CategoryCostCodesCard({
  categories,
  costCodes,
  accounts,
  canEdit,
  managed = false,
  groups = [],
}: {
  /** The company keeps a managed Group > Category list. */
  managed?: boolean;
  groups?: string[];
  categories: Array<{
    category: string;
    group?: string | null;
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
  const [newGroup, setNewGroup] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  function add() {
    setAddError(null);
    start(async () => {
      const res = await addInventoryCategoryAction({ group: newGroup, name: newName });
      if (!res.ok) {
        setAddError(res.error ?? 'Could not add.');
        return;
      }
      setNewName('');
      router.refresh();
    });
  }
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
            {categories.map((c, i) => (
              <div key={c.category}>
              {c.group && c.group !== categories[i - 1]?.group && (
                <div className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {c.group}
                </div>
              )}
              <div
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
              </div>
            ))}
          </div>
          {managed && canEdit && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <input
                list="inventory-category-groups"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                placeholder="Group"
                className="h-9 w-56 rounded-md border border-slate-300 px-2 text-sm"
              />
              <datalist id="inventory-category-groups">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New category name"
                className="h-9 w-72 rounded-md border border-slate-300 px-2 text-sm"
              />
              <button
                type="button"
                disabled={pending || !newGroup.trim() || !newName.trim()}
                onClick={add}
                className="h-9 rounded-md border border-slate-300 px-3 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Add category
              </button>
              {addError && <span className="text-xs text-red-600">{addError}</span>}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
