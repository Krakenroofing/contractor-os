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
import {
  ProjectPicker,
  type ProjectPickerOption,
} from '@/modules/projects/components/project-picker';
import type { CustomerPickerOption } from '@/modules/customers/components/customer-picker';
import {
  VendorPicker,
  type VendorPickerOption,
} from '@/modules/vendors/components/vendor-picker';
import { bulkCategorizeTransactionsAction } from '../actions';

type Txn = {
  id: string;
  date: string;
  description: string;
  payee: string | null;
  amount: number;
  currency: string;
};
type Option = { id: string; label: string };

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

export function BulkCategorizeClient({
  bankAccountId,
  transactions,
  categories,
  projects,
  customers,
  costCodes,
  vendors,
  canEdit,
}: {
  bankAccountId: string;
  transactions: Txn[];
  categories: AccountingAccountOption[];
  projects: ProjectPickerOption[];
  customers: CustomerPickerOption[];
  costCodes: Option[];
  vendors: VendorPickerOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const [projectId, setProjectId] = useState('');
  const [accountingAccountId, setAccountingAccountId] = useState('');
  const [costCodeId, setCostCodeId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [markReviewed, setMarkReviewed] = useState(true);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter((t) =>
      `${t.description} ${t.payee ?? ''}`.toLowerCase().includes(q),
    );
  }, [transactions, query]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((t) => selected.has(t.id));

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
      if (allFilteredSelected) filtered.forEach((t) => next.delete(t.id));
      else filtered.forEach((t) => next.add(t.id));
      return next;
    });
  }

  const nothingToAssign =
    !projectId && !accountingAccountId && !costCodeId && !vendorId && !markReviewed;

  function apply() {
    if (selected.size === 0 || nothingToAssign) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await bulkCategorizeTransactionsAction({
        bankAccountId,
        transactionIds: Array.from(selected),
        accountingAccountId: accountingAccountId || null,
        projectId: projectId || null,
        costCodeId: costCodeId || null,
        vendorId: vendorId || null,
        markReviewed,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not assign.');
        return;
      }
      setMessage(
        `Assigned ${res.applied} transaction${res.applied === 1 ? '' : 's'}.`,
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  if (transactions.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Nothing to categorize — every transaction in this account already has a
        category. 🎉
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-32">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by description or payee…"
          />
        </div>
        <p className="text-xs text-slate-500">
          {selected.size} selected · {filtered.length} shown ·{' '}
          {transactions.length} uncategorized
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAllFiltered}
                  aria-label="Select all shown"
                  disabled={!canEdit}
                />
              </th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((t) => {
              const isSel = selected.has(t.id);
              return (
                <tr
                  key={t.id}
                  className={isSel ? 'bg-blue-50/60' : 'hover:bg-slate-50'}
                  onClick={() => canEdit && toggle(t.id)}
                  style={{ cursor: canEdit ? 'pointer' : 'default' }}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(t.id)}
                      onClick={(e) => e.stopPropagation()}
                      disabled={!canEdit}
                      aria-label={`Select ${t.description}`}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
                    {t.date}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-slate-800">{t.description}</span>
                    {t.payee && (
                      <span className="ml-2 text-xs text-slate-400">{t.payee}</span>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                      t.amount < 0 ? 'text-slate-800' : 'text-emerald-700'
                    }`}
                  >
                    {money(t.amount, t.currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sticky bulk-assign bar */}
      {selected.size > 0 && canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
          <div className="mx-auto max-w-6xl p-3 space-y-2">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
              <div>
                <Label className="text-[11px]">Project</Label>
                <ProjectPicker
                  value={projectId}
                  projects={projects}
                  customers={customers}
                  onChange={(id) => setProjectId(id)}
                />
              </div>
              <div>
                <Label className="text-[11px]">Category</Label>
                <AccountingAccountPicker
                  value={accountingAccountId}
                  onChange={setAccountingAccountId}
                  accounts={categories}
                  placeholder="— category —"
                />
              </div>
              <div>
                <Label className="text-[11px]">Cost code</Label>
                <Select
                  value={costCodeId}
                  onChange={(e) => setCostCodeId(e.target.value)}
                >
                  <option value="">— none —</option>
                  {costCodes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">Vendor</Label>
                <VendorPicker
                  value={vendorId}
                  vendors={vendors}
                  onChange={(id) => setVendorId(id)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={markReviewed}
                  onChange={(e) => setMarkReviewed(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Mark reviewed
              </label>
              <div className="flex items-center gap-3">
                {error && <span className="text-xs text-red-600">{error}</span>}
                {message && (
                  <span className="text-xs text-emerald-700">{message}</span>
                )}
                <Button
                  type="button"
                  onClick={apply}
                  disabled={pending || nothingToAssign}
                >
                  {pending
                    ? 'Assigning…'
                    : `Assign ${selected.size} transaction${selected.size === 1 ? '' : 's'}`}
                </Button>
              </div>
            </div>
            {nothingToAssign && (
              <p className="text-[11px] text-slate-400">
                Pick a project, category, cost code, or vendor (or just “Mark
                reviewed”) to enable assign.
              </p>
            )}
          </div>
        </div>
      )}

      {message && selected.size === 0 && (
        <p className="text-sm text-emerald-700">{message}</p>
      )}
    </div>
  );
}
