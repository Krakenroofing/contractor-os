'use client';

// Office-side "new work order" — for service calls reported by phone or
// verbally, so Chris doesn't have to wait for (or chase) a field
// submission. First crew line = who ran the call. On create it lands as
// 'submitted' and redirects to the detail page for the usual review →
// post → invoice flow.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  CustomerPicker,
  type CustomerPickerOption,
} from '@/modules/customers/components/customer-picker';
import { createWorkOrderOfficeAction } from '../actions';

type EmployeeOption = { id: string; name: string };
type LaborRow = { employeeId: string; hoursText: string };
type MaterialRow = { name: string; qtyText: string; unit: string };

export function OfficeWorkOrderCreateForm({
  employees,
  customers,
  todayIso,
}: {
  employees: EmployeeOption[];
  customers: CustomerPickerOption[];
  todayIso: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [workDate, setWorkDate] = useState(todayIso);
  const [requestedBy, setRequestedBy] = useState('');
  const [repairsDone, setRepairsDone] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [labor, setLabor] = useState<LaborRow[]>([
    { employeeId: '', hoursText: '' },
  ]);
  const [materials, setMaterials] = useState<MaterialRow[]>([
    { name: '', qtyText: '', unit: '' },
  ]);

  function submit() {
    setError(null);
    const laborRows = labor
      .filter((l) => l.employeeId)
      .map((l) => ({
        employeeId: l.employeeId,
        hours: Number(l.hoursText) || 0,
      }));
    if (laborRows.length === 0) {
      setError('Add at least one crew member — the first line is who ran the call.');
      return;
    }
    startTransition(async () => {
      const res = await createWorkOrderOfficeAction({
        workDate,
        requestedBy: requestedBy.trim(),
        repairsDone: repairsDone.trim(),
        customerId,
        labor: laborRows,
        materials: materials
          .filter((m) => m.name.trim())
          .map((m) => ({
            name: m.name.trim(),
            quantity: Number(m.qtyText) || 1,
            unit: m.unit.trim() || undefined,
          })),
      });
      if (!res.ok || !res.id) {
        setError(res.error ?? 'Could not create the work order.');
        return;
      }
      router.push(`/work-orders/${res.id}` as never);
    });
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Work date
          </label>
          <Input
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Who requested the call?
          </label>
          <Input
            value={requestedBy}
            onChange={(e) => setRequestedBy(e.target.value)}
            placeholder="Name and phone if you have it"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Client <span className="text-slate-400">(optional now — required before posting)</span>
        </label>
        <div className="max-w-md">
          <CustomerPicker
            value={customerId}
            onChange={(id) => setCustomerId(id)}
            customers={customers}
            noneLabel="— pick later —"
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 p-3 space-y-2">
        <p className="text-sm font-medium text-slate-800">
          Crew on the call{' '}
          <span className="text-xs font-normal text-slate-500">
            (first line = who ran it)
          </span>
        </p>
        {labor.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-64">
              <Select
                value={l.employeeId}
                onChange={(e) =>
                  setLabor((prev) =>
                    prev.map((r, idx) =>
                      idx === i ? { ...r, employeeId: e.target.value } : r,
                    ),
                  )
                }
              >
                <option value="">— employee —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </div>
            <Input
              value={l.hoursText}
              onChange={(e) =>
                setLabor((prev) =>
                  prev.map((r, idx) =>
                    idx === i ? { ...r, hoursText: e.target.value } : r,
                  ),
                )
              }
              inputMode="decimal"
              placeholder="hrs"
              className="h-9 w-20 text-right tabular-nums"
            />
            <button
              type="button"
              onClick={() =>
                setLabor((prev) => prev.filter((_, idx) => idx !== i))
              }
              className="px-1 text-lg text-slate-400 hover:text-red-600"
              aria-label="Remove crew line"
            >
              ×
            </button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setLabor((prev) => [...prev, { employeeId: '', hoursText: '' }])
          }
        >
          + Add crew member
        </Button>
        <p className="text-[11px] text-slate-500">
          Labor cost rates prefill from each employee&apos;s pay rate — you can
          adjust them on the next screen before posting.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 p-3 space-y-2">
        <p className="text-sm font-medium text-slate-800">Materials used</p>
        {materials.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={m.name}
              onChange={(e) =>
                setMaterials((prev) =>
                  prev.map((r, idx) =>
                    idx === i ? { ...r, name: e.target.value } : r,
                  ),
                )
              }
              placeholder="Material"
              className="h-9 w-72"
            />
            <Input
              value={m.qtyText}
              onChange={(e) =>
                setMaterials((prev) =>
                  prev.map((r, idx) =>
                    idx === i ? { ...r, qtyText: e.target.value } : r,
                  ),
                )
              }
              inputMode="decimal"
              placeholder="qty"
              className="h-9 w-20 text-right tabular-nums"
            />
            <Input
              value={m.unit}
              onChange={(e) =>
                setMaterials((prev) =>
                  prev.map((r, idx) =>
                    idx === i ? { ...r, unit: e.target.value } : r,
                  ),
                )
              }
              placeholder="unit"
              className="h-9 w-24"
            />
            <button
              type="button"
              onClick={() =>
                setMaterials((prev) => prev.filter((_, idx) => idx !== i))
              }
              className="px-1 text-lg text-slate-400 hover:text-red-600"
              aria-label="Remove material"
            >
              ×
            </button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setMaterials((prev) => [...prev, { name: '', qtyText: '', unit: '' }])
          }
        >
          + Add material
        </Button>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Repairs done
        </label>
        <textarea
          value={repairsDone}
          onChange={(e) => setRepairsDone(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="What was wrong and what was done to fix it"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" disabled={pending} onClick={submit}>
          {pending ? 'Creating…' : 'Create work order'}
        </Button>
        <p className="text-xs text-slate-500">
          Opens the review page next — post it there when the client is set.
        </p>
      </div>
    </div>
  );
}
