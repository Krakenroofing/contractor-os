'use client';

// Manual project allocation for pay WITHOUT logged time — the historical
// periods from before time tracking (imported from QuickBooks). Per
// employee: split the period's gross across projects by amount; employer
// NIB follows proportionally. Saving REPLACES that employee's manual
// allocation for the period; time-based "Post labor" never touches these.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatMoney } from '@/lib/money';
import { saveManualLaborAllocationAction } from '../actions';

export type ManualAllocatorEmployee = {
  employeeId: string;
  employeeName: string;
  /** Gross pay for the period (the allocation cap). */
  gross: number;
  /** Wage already covered by time-based posting buckets. */
  timeAllocated: number;
  /** Existing manual allocation rows (wage lines only). */
  manual: Array<{ projectId: string; wage: number }>;
};

type DraftRow = { projectId: string; wageText: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function ManualLaborAllocator({
  payPeriodId,
  employees,
  projects,
}: {
  payPeriodId: string;
  employees: ManualAllocatorEmployee[];
  projects: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedFor, setSavedFor] = useState<string | null>(null);

  if (employees.length === 0) return null;

  function openEditor(e: ManualAllocatorEmployee) {
    setOpenId(e.employeeId);
    setError(null);
    setSavedFor(null);
    setRows(
      e.manual.length > 0
        ? e.manual.map((m) => ({
            projectId: m.projectId,
            wageText: m.wage.toFixed(2),
          }))
        : [{ projectId: '', wageText: '' }],
    );
  }

  function setRow(i: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function save(e: ManualAllocatorEmployee) {
    setError(null);
    const allocations = rows
      .filter((r) => r.projectId && Number(r.wageText) > 0)
      .map((r) => ({ projectId: r.projectId, wage: r2(Number(r.wageText)) }));
    startTransition(async () => {
      const res = await saveManualLaborAllocationAction({
        payPeriodId,
        employeeId: e.employeeId,
        allocations,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not save the allocation.');
        return;
      }
      setOpenId(null);
      setSavedFor(e.employeeName);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-medium text-slate-700">
        Assign pay to projects (no logged time)
      </h3>
      <p className="mt-0.5 mb-2 text-xs text-slate-500">
        For periods from before time tracking: split each person&apos;s gross
        across the projects they worked (same numbers as QuickBooks). Employer
        NIB follows proportionally, and the amounts land in job costing +
        the P&amp;L exactly like posted labor. Saving replaces that
        person&apos;s manual split for this period.
      </p>
      {savedFor && (
        <p className="mb-2 text-xs text-emerald-700">
          Saved — {savedFor}&apos;s allocation posted to job costs.
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {employees.map((e) => {
          const manualTotal = r2(e.manual.reduce((s, m) => s + m.wage, 0));
          const unassigned = r2(
            Math.max(0, e.gross - e.timeAllocated - manualTotal),
          );
          const isOpen = openId === e.employeeId;
          const draftTotal = r2(
            rows.reduce((s, r) => s + (Number(r.wageText) || 0), 0),
          );
          const cap = r2(e.gross - e.timeAllocated);
          return (
            <li key={e.employeeId} className="py-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-900">
                  {e.employeeName}
                </span>
                <span className="text-xs text-slate-500 tabular-nums">
                  gross {formatMoney(e.gross)}
                  {manualTotal > 0 && (
                    <> · {formatMoney(manualTotal)} assigned manually</>
                  )}
                  {unassigned > 0 ? (
                    <>
                      {' '}
                      ·{' '}
                      <span className="text-amber-700">
                        {formatMoney(unassigned)} unassigned
                      </span>
                    </>
                  ) : (
                    <> · <span className="text-emerald-700">fully assigned</span></>
                  )}
                </span>
                <span className="flex-1" />
                {!isOpen && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => openEditor(e)}
                  >
                    {manualTotal > 0 ? 'Edit projects' : 'Assign projects'}
                  </Button>
                )}
              </div>
              {isOpen && (
                <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                  {rows.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-72">
                        <Select
                          value={r.projectId}
                          onChange={(ev) =>
                            setRow(i, { projectId: ev.target.value })
                          }
                        >
                          <option value="">— project —</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <Input
                        value={r.wageText}
                        onChange={(ev) => setRow(i, { wageText: ev.target.value })}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="h-9 w-28 text-right tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setRows((prev) => prev.filter((_, idx) => idx !== i))
                        }
                        className="rounded px-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        aria-label="Remove line"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setRows((prev) => [...prev, { projectId: '', wageText: '' }])
                      }
                    >
                      + Add project
                    </Button>
                    <span
                      className={`text-xs tabular-nums ${
                        draftTotal > cap + 0.01
                          ? 'text-red-600'
                          : 'text-slate-500'
                      }`}
                    >
                      {formatMoney(draftTotal)} of {formatMoney(cap)}
                    </span>
                    <span className="flex-1" />
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending || draftTotal > cap + 0.01}
                      onClick={() => save(e)}
                    >
                      {pending ? 'Saving…' : 'Save allocation'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setOpenId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                  {error && <p className="text-xs text-red-600">{error}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
