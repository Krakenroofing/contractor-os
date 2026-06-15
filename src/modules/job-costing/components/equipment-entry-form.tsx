'use client';

import { useActionState, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { VendorPicker } from '@/modules/vendors/components/vendor-picker';
import {
  createEquipmentEntryAction,
  type CostEntryActionState,
} from '../actions';
import {
  equipmentRateBasisValues,
  EQUIPMENT_RATE_BASIS_LABEL,
} from '../schema';
import type { CostCodeOption, VendorOption } from './cost-entry-form';

export function EquipmentEntryForm({
  projectId,
  costCodes,
  vendors,
}: {
  projectId: string;
  costCodes: CostCodeOption[];
  vendors: VendorOption[];
}) {
  const bound = createEquipmentEntryAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState<
    CostEntryActionState,
    FormData
  >(bound, {});
  const formRef = useRef<HTMLFormElement>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [ownership, setOwnership] = useState<'rented' | 'owned'>('rented');
  const [rate, setRate] = useState('0');
  const [units, setUnits] = useState('1');

  if (state.ok && !state.formError && formRef.current) {
    formRef.current.reset();
    setOwnership('rented');
    setRate('0');
    setUnits('1');
  }

  const total = (() => {
    const r = Number(rate);
    const u = Number(units);
    return Number.isFinite(r) && Number.isFinite(u) ? r * u : 0;
  })();

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
          <Label className="text-xs">Ownership</Label>
          <Select
            name="ownership"
            value={ownership}
            onChange={(e) => setOwnership(e.target.value as 'rented' | 'owned')}
            className="bg-white"
          >
            <option value="rented">Rented</option>
            <option value="owned">Owned (allocation)</option>
          </Select>
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">
            {ownership === 'rented' ? 'Rental vendor' : 'Vendor (optional)'}
          </Label>
          <VendorPicker
            name="vendorId"
            noneLabel="—"
            className="bg-white"
            vendors={vendors}
          />
        </div>

        <div className="md:col-span-6">
          <Label className="text-xs">Equipment</Label>
          <Input
            name="equipmentName"
            required
            placeholder="e.g. 60-ton crane, scissor lift, welder"
            className="bg-white"
          />
          {state.errors?.equipmentName && (
            <p className="text-xs text-red-600 mt-1">
              {state.errors.equipmentName[0]}
            </p>
          )}
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Rate basis</Label>
          <Select name="rateBasis" defaultValue="day" className="bg-white">
            {equipmentRateBasisValues.map((b) => (
              <option key={b} value={b}>
                {EQUIPMENT_RATE_BASIS_LABEL[b]}
              </option>
            ))}
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Rate</Label>
          <Input
            type="number"
            step="0.01"
            name="rate"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="bg-white tabular-nums"
          />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Units (days/weeks/months)</Label>
          <Input
            type="number"
            step="0.25"
            name="units"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            className="bg-white tabular-nums"
          />
        </div>

        <div className="md:col-span-6">
          <Label className="text-xs">Notes (optional)</Label>
          <Input
            name="notes"
            placeholder="Operator included, fuel charges, etc."
            className="bg-white"
          />
        </div>
        <div className="md:col-span-2 flex flex-col justify-end text-xs">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            Total
          </span>
          <span className="text-base font-semibold tabular-nums text-slate-900">
            ${total.toFixed(2)}
          </span>
        </div>
        <div className="md:col-span-2" />
        <div className="md:col-span-2 flex items-end">
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Saving…' : 'Add equipment'}
          </Button>
        </div>
      </div>

      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
      {state.ok && !state.formError && (
        <p className="text-xs text-emerald-700">Equipment entry added.</p>
      )}
    </form>
  );
}
