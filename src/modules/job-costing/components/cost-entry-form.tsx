'use client';

import { useActionState, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { VendorPicker } from '@/modules/vendors/components/vendor-picker';
import {
  createCostEntryAction,
  type CostEntryActionState,
} from '../actions';
import {
  jobCostTypeValues,
  JOB_COST_TYPE_LABEL,
} from '../schema';

export type CostCodeOption = {
  id: string;
  code: string;
  description: string;
  division: string | null;
};

export type VendorOption = { id: string; name: string };

export function CostEntryForm({
  projectId,
  costCodes,
  vendors,
}: {
  projectId: string;
  costCodes: CostCodeOption[];
  vendors: VendorOption[];
}) {
  const bound = createCostEntryAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState<
    CostEntryActionState,
    FormData
  >(bound, {});
  const formRef = useRef<HTMLFormElement>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('0');
  const [amountOverride, setAmountOverride] = useState('');

  if (state.ok && !state.formError && formRef.current) {
    formRef.current.reset();
    setQuantity('1');
    setUnitCost('0');
    setAmountOverride('');
  }

  const derivedAmount = (() => {
    if (amountOverride.trim() !== '') {
      const o = Number(amountOverride);
      return Number.isFinite(o) ? o : 0;
    }
    const q = Number(quantity);
    const u = Number(unitCost);
    return Number.isFinite(q) && Number.isFinite(u) ? q * u : 0;
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
          <Label className="text-xs">Cost type</Label>
          <Select name="costType" defaultValue="other" className="bg-white">
            {jobCostTypeValues.map((t) => (
              <option key={t} value={t}>
                {JOB_COST_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">Vendor (optional)</Label>
          <VendorPicker
            name="vendorId"
            noneLabel="—"
            className="bg-white"
            vendors={vendors}
          />
        </div>

        <div className="md:col-span-12">
          <Label className="text-xs">Description</Label>
          <Input
            name="description"
            required
            placeholder="What was this cost for?"
            className="bg-white"
          />
          {state.errors?.description && (
            <p className="text-xs text-red-600 mt-1">{state.errors.description[0]}</p>
          )}
        </div>

        <div className="md:col-span-2">
          <Label className="text-xs">Quantity</Label>
          <Input
            type="number"
            step="0.0001"
            name="quantity"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="bg-white tabular-nums"
          />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Unit cost</Label>
          <Input
            type="number"
            step="0.0001"
            name="unitCost"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            className="bg-white tabular-nums"
          />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Total override</Label>
          <Input
            type="number"
            step="0.01"
            name="amount"
            value={amountOverride}
            onChange={(e) => setAmountOverride(e.target.value)}
            placeholder={derivedAmount.toFixed(2)}
            className="bg-white tabular-nums"
          />
          {state.errors?.amount && (
            <p className="text-xs text-red-600 mt-1">{state.errors.amount[0]}</p>
          )}
        </div>
        <div className="md:col-span-2 flex items-end">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              name="isBillable"
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>Billable</span>
          </label>
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Markup %</Label>
          <Input
            type="number"
            step="0.001"
            name="markupPercent"
            placeholder="e.g. 15"
            className="bg-white tabular-nums"
          />
        </div>
        <div className="md:col-span-2 flex flex-col justify-end text-xs text-slate-600">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            Total
          </span>
          <span className="text-base font-semibold tabular-nums text-slate-900">
            ${derivedAmount.toFixed(2)}
          </span>
        </div>

        <div className="md:col-span-10">
          <Label className="text-xs">Notes (optional)</Label>
          <Input
            name="notes"
            placeholder="Reference invoice #, justification, etc."
            className="bg-white"
          />
        </div>
        <div className="md:col-span-2 flex items-end">
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Saving…' : 'Add cost entry'}
          </Button>
        </div>
      </div>

      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
      {state.ok && !state.formError && (
        <p className="text-xs text-emerald-700">Cost entry added.</p>
      )}
    </form>
  );
}
