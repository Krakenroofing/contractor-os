'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatMoney } from '@/lib/money';
import { calcEstimateTotals, lineTotal } from '../lib/calc';
import { createEstimateAction, type CreateEstimateState } from '../actions';
import { estimateStatusValues, STATUS_LABEL } from '../schema';
import {
  ProductPicker,
  type ProductPickerOption,
} from '@/modules/inventory/components/product-picker';

const initialState: CreateEstimateState = {};

type LineDraft = {
  rowId: string;
  costCodeId: string;
  inventoryItemId: string;
  description: string;
  unit: string;
  quantity: string;
  unitCost: string;
  markupPercent: string;
};

type ProjectOption = { id: string; label: string };
type CostCodeOption = { id: string; code: string; description: string };

function newEmptyLine(): LineDraft {
  return {
    rowId: crypto.randomUUID(),
    costCodeId: '',
    inventoryItemId: '',
    description: '',
    unit: '',
    quantity: '0',
    unitCost: '0',
    markupPercent: '0',
  };
}

export function EstimateForm({
  projects,
  costCodes,
  products,
  defaultNumber,
}: {
  projects: ProjectOption[];
  costCodes: CostCodeOption[];
  products: ProductPickerOption[];
  defaultNumber: string;
}) {
  const [state, formAction, pending] = useActionState(createEstimateAction, initialState);
  const [lines, setLines] = useState<LineDraft[]>([newEmptyLine()]);

  const totals = useMemo(
    () =>
      calcEstimateTotals(
        lines.map((l) => ({
          quantity: Number(l.quantity) || 0,
          unitCost: Number(l.unitCost) || 0,
          markupPercent: Number(l.markupPercent) || 0,
        })),
      ),
    [lines],
  );

  const linesPayload = lines.map((l) => ({
    costCodeId: l.costCodeId,
    inventoryItemId: l.inventoryItemId,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity,
    unitCost: l.unitCost,
    markupPercent: l.markupPercent,
  }));

  const updateLine = (rowId: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l) => (l.rowId === rowId ? { ...l, ...patch } : l)));
  };

  const onCostCodeChange = (rowId: string, costCodeId: string) => {
    const code = costCodes.find((c) => c.id === costCodeId);
    setLines((prev) =>
      prev.map((l) =>
        l.rowId === rowId
          ? {
              ...l,
              costCodeId,
              description: l.description.trim() === '' && code ? code.description : l.description,
            }
          : l,
      ),
    );
  };

  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      <input type="hidden" name="lines" value={JSON.stringify(linesPayload)} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Estimate number" error={err('number')} required>
          <Input name="number" defaultValue={defaultNumber} required />
        </Field>

        <Field label="Status" error={err('status')}>
          <Select name="status" defaultValue="draft">
            {estimateStatusValues.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Project" error={err('projectId')} className="md:col-span-2" required>
          <Select name="projectId" required defaultValue="">
            <option value="" disabled>
              {projects.length === 0
                ? 'No projects — create one first'
                : 'Select a project'}
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Valid until" error={err('validUntil')}>
          <Input name="validUntil" type="date" />
        </Field>
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-3">
        <legend className="px-2 text-sm font-medium text-slate-700">Line items</legend>

        {err('lines') && <p className="text-xs text-red-600">{err('lines')}</p>}

        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-[1.6fr_1.4fr_2fr_0.7fr_0.6fr_0.9fr_0.7fr_1fr_auto] gap-2 px-1 text-xs font-medium text-slate-500">
            <span>Product</span>
            <span>Cost code</span>
            <span>Description</span>
            <span>Qty</span>
            <span>Unit</span>
            <span>Unit cost</span>
            <span>Markup %</span>
            <span className="text-right">Line total</span>
            <span />
          </div>

          {lines.map((line) => {
            const sell = lineTotal({
              quantity: Number(line.quantity) || 0,
              unitCost: Number(line.unitCost) || 0,
              markupPercent: Number(line.markupPercent) || 0,
            });
            return (
              <div
                key={line.rowId}
                className="grid grid-cols-1 md:grid-cols-[1.6fr_1.4fr_2fr_0.7fr_0.6fr_0.9fr_0.7fr_1fr_auto] gap-2 items-start"
              >
                <ProductPicker
                  value={line.inventoryItemId}
                  options={products}
                  onItemSelected={(picked) => {
                    if (!picked) {
                      updateLine(line.rowId, { inventoryItemId: '' });
                      return;
                    }
                    updateLine(line.rowId, {
                      inventoryItemId: picked.id,
                      description:
                        line.description.trim() === '' ? picked.name : line.description,
                      unit:
                        line.unit.trim() === '' && picked.unit
                          ? picked.unit
                          : line.unit,
                      unitCost:
                        (Number(line.unitCost) || 0) === 0 && picked.defaultCost > 0
                          ? picked.defaultCost.toString()
                          : line.unitCost,
                    });
                  }}
                />
                <Select
                  value={line.costCodeId}
                  onChange={(e) => onCostCodeChange(line.rowId, e.target.value)}
                >
                  <option value="" disabled>
                    Select code
                  </option>
                  {costCodes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.description}
                    </option>
                  ))}
                </Select>
                <Input
                  value={line.description}
                  onChange={(e) => updateLine(line.rowId, { description: e.target.value })}
                  placeholder="Description"
                />
                <Input
                  value={line.quantity}
                  onChange={(e) => updateLine(line.rowId, { quantity: e.target.value })}
                  inputMode="decimal"
                />
                <Input
                  value={line.unit}
                  onChange={(e) => updateLine(line.rowId, { unit: e.target.value })}
                  placeholder="ea"
                />
                <Input
                  value={line.unitCost}
                  onChange={(e) => updateLine(line.rowId, { unitCost: e.target.value })}
                  inputMode="decimal"
                />
                <Input
                  value={line.markupPercent}
                  onChange={(e) => updateLine(line.rowId, { markupPercent: e.target.value })}
                  inputMode="decimal"
                />
                <div className="flex items-center justify-end h-10 px-2 text-sm tabular-nums text-slate-900">
                  {formatMoney(sell)}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLines((prev) => prev.filter((l) => l.rowId !== line.rowId))}
                  disabled={lines.length === 1}
                  aria-label="Remove line"
                >
                  ✕
                </Button>
              </div>
            );
          })}
        </div>

        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((prev) => [...prev, newEmptyLine()])}
          >
            + Add line
          </Button>
        </div>
      </fieldset>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Subtotal (cost)</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {formatMoney(totals.subtotal)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Markup</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums text-emerald-700">
            {formatMoney(totals.markup)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {formatMoney(totals.total)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create estimate'}
        </Button>
        <Link href="/estimates">
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
  className,
  required,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
