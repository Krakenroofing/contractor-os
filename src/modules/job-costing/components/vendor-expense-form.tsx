'use client';

import { useActionState, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createVendorExpenseAction,
  type CostEntryActionState,
} from '../actions';
import {
  jobCostTypeValues,
  JOB_COST_TYPE_LABEL,
} from '../schema';
import type { CostCodeOption, VendorOption } from './cost-entry-form';

export function VendorExpenseForm({
  projectId,
  costCodes,
  vendors,
}: {
  projectId: string;
  costCodes: CostCodeOption[];
  vendors: VendorOption[];
}) {
  const bound = createVendorExpenseAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState<
    CostEntryActionState,
    FormData
  >(bound, {});
  const formRef = useRef<HTMLFormElement>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [subtotal, setSubtotal] = useState('0');
  const [vatPct, setVatPct] = useState('');
  const [freight, setFreight] = useState('');
  const [duty, setDuty] = useState('');

  if (state.ok && !state.formError && formRef.current) {
    formRef.current.reset();
    setSubtotal('0');
    setVatPct('');
    setFreight('');
    setDuty('');
  }

  const subtotalNum = Number(subtotal);
  const vatNum = vatPct ? subtotalNum * (Number(vatPct) / 100) : 0;
  const freightNum = freight ? Number(freight) : 0;
  const dutyNum = duty ? Number(duty) : 0;
  const grandTotal =
    (Number.isFinite(subtotalNum) ? subtotalNum : 0) +
    (Number.isFinite(vatNum) ? vatNum : 0) +
    (Number.isFinite(freightNum) ? freightNum : 0) +
    (Number.isFinite(dutyNum) ? dutyNum : 0);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-2">
          <Label className="text-xs">Invoice date</Label>
          <Input
            type="date"
            name="entryDate"
            defaultValue={today}
            required
            className="bg-white"
          />
        </div>
        <div className="md:col-span-4">
          <Label className="text-xs">Vendor</Label>
          <Select name="vendorId" required className="bg-white">
            <option value="">Choose vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          {state.errors?.vendorId && (
            <p className="text-xs text-red-600 mt-1">{state.errors.vendorId[0]}</p>
          )}
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">Invoice #</Label>
          <Input
            name="invoiceNumber"
            required
            placeholder="e.g. INV-12345"
            className="bg-white"
          />
          {state.errors?.invoiceNumber && (
            <p className="text-xs text-red-600 mt-1">
              {state.errors.invoiceNumber[0]}
            </p>
          )}
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">Subtotal cost type</Label>
          <Select
            name="subtotalCostType"
            defaultValue="materials"
            className="bg-white"
          >
            {jobCostTypeValues.map((t) => (
              <option key={t} value={t}>
                {JOB_COST_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>

        <div className="md:col-span-6">
          <Label className="text-xs">Cost code (applies to all sub-lines)</Label>
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
        <div className="md:col-span-6">
          <Label className="text-xs">Description</Label>
          <Input
            name="description"
            required
            placeholder="What was invoiced?"
            className="bg-white"
          />
          {state.errors?.description && (
            <p className="text-xs text-red-600 mt-1">
              {state.errors.description[0]}
            </p>
          )}
        </div>

        <div className="md:col-span-3">
          <Label className="text-xs">Subtotal</Label>
          <Input
            type="number"
            step="0.01"
            name="subtotal"
            value={subtotal}
            onChange={(e) => setSubtotal(e.target.value)}
            className="bg-white tabular-nums"
          />
          {state.errors?.subtotal && (
            <p className="text-xs text-red-600 mt-1">{state.errors.subtotal[0]}</p>
          )}
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">VAT % (optional)</Label>
          <Input
            type="number"
            step="0.001"
            name="vatPercent"
            value={vatPct}
            onChange={(e) => setVatPct(e.target.value)}
            placeholder="e.g. 10"
            className="bg-white tabular-nums"
          />
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">Freight $ (optional)</Label>
          <Input
            type="number"
            step="0.01"
            name="freightAmount"
            value={freight}
            onChange={(e) => setFreight(e.target.value)}
            className="bg-white tabular-nums"
          />
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">Customs duty $ (optional)</Label>
          <Input
            type="number"
            step="0.01"
            name="dutyAmount"
            value={duty}
            onChange={(e) => setDuty(e.target.value)}
            className="bg-white tabular-nums"
          />
        </div>

        <div className="md:col-span-8">
          <Label className="text-xs">Notes (optional)</Label>
          <Input
            name="notes"
            placeholder="PO reference, payment terms, etc."
            className="bg-white"
          />
        </div>
        <div className="md:col-span-2 flex flex-col justify-end text-xs">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            Grand total
          </span>
          <span className="text-base font-semibold tabular-nums text-slate-900">
            ${grandTotal.toFixed(2)}
          </span>
        </div>
        <div className="md:col-span-2 flex items-end">
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Saving…' : 'Add invoice'}
          </Button>
        </div>
      </div>

      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
      {state.ok && !state.formError && (
        <p className="text-xs text-emerald-700">
          Vendor invoice posted ({vatPct ? 'with VAT' : 'no VAT'}
          {freightNum > 0 ? ' + freight' : ''}
          {dutyNum > 0 ? ' + duty' : ''}).
        </p>
      )}
    </form>
  );
}
