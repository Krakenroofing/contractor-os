'use client';

import { useActionState, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createLaborEntryAction,
  type CostEntryActionState,
} from '../actions';
import type { CostCodeOption } from './cost-entry-form';

export function LaborEntryForm({
  projectId,
  costCodes,
}: {
  projectId: string;
  costCodes: CostCodeOption[];
}) {
  const bound = createLaborEntryAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState<
    CostEntryActionState,
    FormData
  >(bound, {});
  const formRef = useRef<HTMLFormElement>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [hours, setHours] = useState('0');
  const [rate, setRate] = useState('0');
  const [burden, setBurden] = useState('');

  if (state.ok && !state.formError && formRef.current) {
    formRef.current.reset();
    setHours('0');
    setRate('0');
    setBurden('');
  }

  const subtotal = (() => {
    const h = Number(hours);
    const r = Number(rate);
    return Number.isFinite(h) && Number.isFinite(r) ? h * r : 0;
  })();
  const burdenNum = Number(burden);
  const total =
    subtotal * (1 + (Number.isFinite(burdenNum) ? burdenNum : 0) / 100);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-2">
          <Label className="text-xs">Date</Label>
          <Input
            type="date"
            name="entryDate"
            defaultValue={today}
            required
            className="bg-white"
          />
        </div>
        <div className="md:col-span-4">
          <Label className="text-xs">Cost code</Label>
          <Select name="costCodeId" required className="bg-white">
            <option value="">Choose…</option>
            {costCodes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.description}
              </option>
            ))}
          </Select>
          {state.errors?.costCodeId && (
            <p className="text-xs text-red-600 mt-1">{state.errors.costCodeId[0]}</p>
          )}
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">Crew / company (optional)</Label>
          <Input
            name="crewCompany"
            placeholder="In-house, Sub Co., etc."
            className="bg-white"
          />
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">Trade (optional)</Label>
          <Input
            name="trade"
            placeholder="Foreman, Carpenter, …"
            className="bg-white"
          />
        </div>

        <div className="md:col-span-6">
          <Label className="text-xs">Worker / crew name</Label>
          <Input
            name="workerName"
            required
            placeholder="e.g. John Smith, Crew A"
            className="bg-white"
          />
          {state.errors?.workerName && (
            <p className="text-xs text-red-600 mt-1">{state.errors.workerName[0]}</p>
          )}
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs"># workers</Label>
          <Input
            type="number"
            name="workerCount"
            min={1}
            defaultValue={1}
            className="bg-white tabular-nums"
          />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Total hours</Label>
          <Input
            type="number"
            step="0.25"
            name="hours"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="bg-white tabular-nums"
          />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Hourly rate</Label>
          <Input
            type="number"
            step="0.01"
            name="hourlyRate"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="bg-white tabular-nums"
          />
        </div>

        <div className="md:col-span-2">
          <Label className="text-xs">Burden % (optional)</Label>
          <Input
            type="number"
            step="0.1"
            name="burdenPercent"
            value={burden}
            onChange={(e) => setBurden(e.target.value)}
            placeholder="e.g. 30"
            className="bg-white tabular-nums"
          />
        </div>
        <div className="md:col-span-2 flex flex-col justify-end text-xs">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            Subtotal
          </span>
          <span className="text-sm tabular-nums text-slate-600">
            ${subtotal.toFixed(2)}
          </span>
        </div>
        <div className="md:col-span-2 flex flex-col justify-end text-xs">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            Total (w/ burden)
          </span>
          <span className="text-base font-semibold tabular-nums text-slate-900">
            ${total.toFixed(2)}
          </span>
        </div>
        <div className="md:col-span-4">
          <Label className="text-xs">Notes (optional)</Label>
          <Input
            name="notes"
            placeholder="Job site, shift, etc."
            className="bg-white"
          />
        </div>
        <div className="md:col-span-2 flex items-end">
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Saving…' : 'Add labor'}
          </Button>
        </div>
      </div>

      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
      {state.ok && !state.formError && (
        <p className="text-xs text-emerald-700">Labor entry added.</p>
      )}
    </form>
  );
}
