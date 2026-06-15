'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setProjectBudgetAction } from '@/modules/projects/actions';

export type BudgetRow = {
  projectId: string;
  projectName: string;
  customerName: string;
  status: string;
  contractValue: number;
  actualCost: number;
  budget: number;
};

function money(n: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return n.toFixed(0);
  }
}

export function WipBudgetsClient({
  rows,
  canEdit,
}: {
  rows: BudgetRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [budgets, setBudgets] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rows.map((r) => [r.projectId, r.budget > 0 ? String(r.budget) : '']),
    ),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.projectName} ${r.customerName}`.toLowerCase().includes(q),
    );
  }, [rows, query]);

  function save(r: BudgetRow) {
    const val = budgets[r.projectId] ?? '';
    setError(null);
    setSavedId(null);
    setSavingId(r.projectId);
    startTransition(async () => {
      const res = await setProjectBudgetAction({
        projectId: r.projectId,
        budget: val === '' ? '0' : val,
      });
      setSavingId(null);
      if (!res.ok) {
        setError(`${r.projectName}: ${res.error ?? 'Could not save.'}`);
        return;
      }
      setSavedId(r.projectId);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
        No contracts with a contract value to budget yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by project or customer…"
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2 text-right">Contract</th>
              <th className="px-3 py-2 text-right">Cost to date</th>
              <th className="px-3 py-2 text-right">Budget (est. total cost)</th>
              <th className="px-3 py-2 text-right">% complete</th>
              <th className="px-3 py-2 text-right">Proj. margin</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => {
              const val = budgets[r.projectId] ?? '';
              const b = Number(val) || 0;
              const pct = b > 0 ? (r.actualCost / b) * 100 : null;
              const gp = r.contractValue - b;
              const marginPct =
                r.contractValue > 0 ? (gp / r.contractValue) * 100 : 0;
              const dirty = (val === '' ? 0 : Number(val)) !== r.budget;
              return (
                <tr key={r.projectId} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <span className="text-slate-800">{r.projectName}</span>
                    <span className="ml-2 text-xs text-slate-400">
                      {r.customerName} · {r.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                    {money(r.contractValue)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                    {money(r.actualCost)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      value={val}
                      inputMode="decimal"
                      disabled={!canEdit}
                      onChange={(e) =>
                        setBudgets((prev) => ({
                          ...prev,
                          [r.projectId]: e.target.value,
                        }))
                      }
                      placeholder="—"
                      className="h-8 w-32 text-right tabular-nums"
                    />
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                      pct === null
                        ? 'text-slate-300'
                        : pct > 100
                          ? 'text-red-600'
                          : 'text-slate-800'
                    }`}
                  >
                    {pct === null ? '— set budget' : `${pct.toFixed(0)}%`}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                      b === 0
                        ? 'text-slate-300'
                        : gp >= 0
                          ? 'text-emerald-700'
                          : 'text-red-600'
                    }`}
                  >
                    {b === 0 ? '—' : `${money(gp)} (${marginPct.toFixed(0)}%)`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canEdit && (
                      <Button
                        type="button"
                        size="sm"
                        variant={dirty ? 'default' : 'outline'}
                        disabled={!dirty || (pending && savingId === r.projectId)}
                        onClick={() => save(r)}
                      >
                        {savingId === r.projectId
                          ? 'Saving…'
                          : savedId === r.projectId && !dirty
                            ? 'Saved'
                            : 'Save'}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Budget = your estimated total cost for the job. % complete = cost to
        date ÷ budget, which drives earned revenue on the WIP report and the
        P&amp;L revenue-recognition section. A detailed estimate or cost
        forecast, when present, takes precedence over this number.
      </p>
    </div>
  );
}
