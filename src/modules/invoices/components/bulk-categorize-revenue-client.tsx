'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  AccountingAccountPicker,
  type AccountingAccountOption,
} from '@/modules/accounting/components/accounting-account-picker';
import { bulkSetInvoiceRevenueCategoryAction } from '../actions';

export type RevenueInvoiceRow = {
  id: string;
  number: string;
  date: string;
  projectId: string;
  projectName: string;
  customerName: string;
  amount: number;
  status: string;
  categoryId: string | null;
};
type Option = { id: string; label: string };

function money(n: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

export function BulkCategorizeRevenueClient({
  invoices,
  projects,
  incomeAccounts,
  canEdit,
}: {
  invoices: RevenueInvoiceRow[];
  projects: Option[];
  incomeAccounts: AccountingAccountOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [showCategorized, setShowCategorized] = useState(false);
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catName = useMemo(
    () =>
      new Map(
        incomeAccounts.filter((a) => !a.isHeader).map((a) => [a.id, a.name]),
      ),
    [incomeAccounts],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (projectFilter && inv.projectId !== projectFilter) return false;
      if (!showCategorized && inv.categoryId) return false;
      if (
        q &&
        !`${inv.number} ${inv.projectName} ${inv.customerName}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [invoices, query, projectFilter, showCategorized]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((i) => selected.has(i.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((i) => next.delete(i.id));
      else filtered.forEach((i) => next.add(i.id));
      return next;
    });
  }

  function apply() {
    if (selected.size === 0 || !category) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await bulkSetInvoiceRevenueCategoryAction({
        invoiceIds: Array.from(selected),
        accountingAccountId: category,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not assign.');
        return;
      }
      setMessage(
        `Categorized ${res.applied} invoice${res.applied === 1 ? '' : 's'}.`,
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 pb-32">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by invoice #, project, or customer…"
          />
        </div>
        <Select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
        <label className="inline-flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showCategorized}
            onChange={(e) => setShowCategorized(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Show already-categorized
        </label>
      </div>

      <p className="text-xs text-slate-500">
        {selected.size} selected · {filtered.length} shown · {invoices.length}{' '}
        total (non-void)
      </p>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAllFiltered}
                  disabled={!canEdit}
                  aria-label="Select all shown"
                />
              </th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Invoice</th>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Revenue category</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((inv) => {
              const isSel = selected.has(inv.id);
              return (
                <tr
                  key={inv.id}
                  className={isSel ? 'bg-blue-50/60' : 'hover:bg-slate-50'}
                  onClick={() => canEdit && toggle(inv.id)}
                  style={{ cursor: canEdit ? 'pointer' : 'default' }}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(inv.id)}
                      onClick={(e) => e.stopPropagation()}
                      disabled={!canEdit}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
                    {inv.date}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                    {inv.number}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-slate-800">{inv.projectName}</span>
                    <span className="ml-2 text-xs text-slate-400">
                      {inv.customerName}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">
                    {money(inv.amount)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {inv.categoryId ? (
                      <span className="text-slate-600">
                        {catName.get(inv.categoryId) ?? 'Categorized'}
                      </span>
                    ) : (
                      <span className="text-amber-700">Uncategorized</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-end gap-3">
            <div className="min-w-[260px] flex-1">
              <Label className="text-[11px]">Revenue category</Label>
              <AccountingAccountPicker
                value={category}
                onChange={setCategory}
                accounts={incomeAccounts}
                placeholder="— pick a revenue category —"
              />
            </div>
            <div className="flex items-center gap-3">
              {error && <span className="text-xs text-red-600">{error}</span>}
              {message && (
                <span className="text-xs text-emerald-700">{message}</span>
              )}
              <Button
                type="button"
                onClick={apply}
                disabled={pending || !category}
              >
                {pending
                  ? 'Assigning…'
                  : `Categorize ${selected.size} invoice${selected.size === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {message && selected.size === 0 && (
        <p className="text-sm text-emerald-700">{message}</p>
      )}
    </div>
  );
}
