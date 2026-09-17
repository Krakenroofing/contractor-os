'use client';

// Full PO edit: header (vendor, project, dates, tax/shipping, notes) +
// the line set, including per-line job overrides — so one PO can be
// re-split across jobs, or another PO's lines folded in. Existing lines
// keep their id so received quantities and receipt history survive the
// edit; a line with receipts can't be removed (adjust its qty instead).

import { useActionState, useMemo, useState } from 'react';
import { useUnsavedChangesGuard } from '@/lib/use-unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VendorPicker } from '@/modules/vendors/components/vendor-picker';
import { ProjectPicker } from '@/modules/projects/components/project-picker';
import type { CustomerPickerOption } from '@/modules/customers/components/customer-picker';
import { CostCodePicker } from '@/modules/cost-codes/components/cost-code-picker';
import {
  SortableHeader,
  toggleSort,
  type SortState,
} from '@/components/ui/sortable-header';
import { sortLines } from '../line-sort';
import { calcPOTotals, formatMoney, multiply } from '@/lib/money';
import {
  updatePurchaseOrderAction,
  type UpdatePurchaseOrderState,
} from '../actions';

const initialState: UpdatePurchaseOrderState = {};

type Option = { id: string; label: string };
type CostCodeOption = {
  id: string;
  code: string;
  description: string;
  defaultCost: number | null;
};

export type EditLineInitial = {
  id: string;
  costCodeId: string;
  inventoryItemId: string;
  projectId: string;
  description: string;
  unit: string;
  quantity: string;
  unitCost: string;
  quantityReceived: number;
};

type LineDraft = EditLineInitial & { rowId: string };

export function PurchaseOrderEditForm({
  poId,
  status,
  initial,
  projects,
  vendors,
  customers,
  costCodes,
}: {
  poId: string;
  status: string;
  initial: {
    projectId: string;
    vendorId: string;
    issueDate: string;
    expectedDeliveryDate: string;
    taxAmount: string;
    shipping: string;
    notes: string;
    lines: EditLineInitial[];
  };
  projects: Option[];
  vendors: Option[];
  customers: CustomerPickerOption[];
  costCodes: CostCodeOption[];
}) {
  const [state, formAction, pending] = useActionState(
    updatePurchaseOrderAction,
    initialState,
  );
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty);

  const [projectId, setProjectId] = useState(initial.projectId);
  const [taxAmount, setTaxAmount] = useState(initial.taxAmount);
  const [shipping, setShipping] = useState(initial.shipping);
  const [lines, setLines] = useState<LineDraft[]>(() =>
    initial.lines.map((l) => ({ ...l, rowId: crypto.randomUUID() })),
  );
  const [sort, setSort] = useState<SortState>(null);

  const updateLine = (rowId: string, patch: Partial<LineDraft>) => {
    setDirty(true);
    setLines((prev) =>
      prev.map((l) => (l.rowId === rowId ? { ...l, ...patch } : l)),
    );
  };
  // New lines land at the TOP: on a long PO the "+ Add line" button is
  // right there and the new row is in view — no scrolling to the bottom
  // and back. Adding also drops any active sort so the row can't appear
  // to land somewhere else.
  const addLine = () => {
    setDirty(true);
    setSort(null);
    setLines((prev) => [
      {
        rowId: crypto.randomUUID(),
        id: '',
        costCodeId: '',
        inventoryItemId: '',
        projectId: '',
        description: '',
        unit: '',
        quantity: '0',
        unitCost: '0',
        quantityReceived: 0,
      },
      ...prev,
    ]);
  };
  const removeLine = (rowId: string) => {
    setDirty(true);
    setLines((prev) => prev.filter((l) => l.rowId !== rowId));
  };

  // Sorting reorders the draft rows themselves, so the order on screen is
  // the order that saves (lines persist in the order they're submitted).
  const onSort = (key: string) => {
    const next = toggleSort(sort, key);
    setSort(next);
    setDirty(true);
    setLines((prev) =>
      sortLines(prev, next, (l) => ({
        description: l.description,
        unit: l.unit,
        quantity: Number(l.quantity) || 0,
        unitCost: Number(l.unitCost) || 0,
      })),
    );
  };

  // Shown in the per-line Job column so "same as the PO" names the actual job.
  const poProjectLabel = projects.find((p) => p.id === projectId)?.label ?? '';

  const totals = useMemo(
    () =>
      calcPOTotals({
        lines: lines.map((l) => ({
          quantityOrdered: Number(l.quantity) || 0,
          unitCost: Number(l.unitCost) || 0,
        })),
        taxAmount: Number(taxAmount) || 0,
        shipping: Number(shipping) || 0,
      }),
    [lines, taxAmount, shipping],
  );

  const linesPayload = lines.map((l) => ({
    id: l.id,
    costCodeId: l.costCodeId,
    inventoryItemId: l.inventoryItemId,
    projectId: l.projectId,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity,
    unitCost: l.unitCost,
  }));

  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form
      action={formAction}
      onSubmit={() => setDirty(false)}
      className="space-y-6"
      onChange={() => setDirty(true)}
    >
      <input type="hidden" name="id" value={poId} />
      <input type="hidden" name="lines" value={JSON.stringify(linesPayload)} />

      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}
      {status !== 'draft' && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-800">
          This PO is already {status === 'issued' ? 'ordered' : status} — saving
          changes what receiving, job costing, and the AP report see. Committed
          costs recompute from the new lines.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Vendor</Label>
          <VendorPicker
            name="vendorId"
            required
            allowNone={false}
            defaultValue={initial.vendorId}
            vendors={vendors.map((v) => ({ id: v.id, name: v.label }))}
          />
          {err('vendorId') && (
            <p className="text-xs text-red-600">{err('vendorId')}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Project (the PO&apos;s main job)</Label>
          <ProjectPicker
            name="projectId"
            required
            allowNone={false}
            defaultValue={initial.projectId}
            projects={projects.map((p) => ({ id: p.id, name: p.label }))}
            customers={customers}
            onChange={(id) => setProjectId(id)}
          />
          {err('projectId') && (
            <p className="text-xs text-red-600">{err('projectId')}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Issue date</Label>
          <Input type="date" name="issueDate" defaultValue={initial.issueDate} />
        </div>
        <div className="space-y-1.5">
          <Label>Expected delivery</Label>
          <Input
            type="date"
            name="expectedDeliveryDate"
            defaultValue={initial.expectedDeliveryDate}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Line items ({lines.length})</Label>
          <div className="flex items-center gap-2">
            {sort && (
              <span className="text-xs text-slate-500">
                Sorted — this order saves.
              </span>
            )}
            <Button type="button" size="sm" variant="outline" onClick={addLine}>
              + Add line
            </Button>
          </div>
        </div>
        <div className="hidden md:grid md:grid-cols-[1.5fr_1.5fr_1.8fr_0.7fr_0.55fr_0.85fr_0.95fr_auto] gap-2 text-[11px] uppercase tracking-wide text-slate-500">
          <span>Cost code</span>
          <span>Job</span>
          <SortableHeader
            label="Description"
            sortKey="description"
            sort={sort}
            onSort={onSort}
          />
          <SortableHeader
            label="Qty"
            sortKey="quantity"
            sort={sort}
            onSort={onSort}
          />
          <SortableHeader
            label="Unit"
            sortKey="unit"
            sort={sort}
            onSort={onSort}
          />
          <SortableHeader
            label="Unit cost"
            sortKey="unitCost"
            sort={sort}
            onSort={onSort}
          />
          <SortableHeader
            label="Line total"
            sortKey="total"
            sort={sort}
            onSort={onSort}
            align="right"
          />
          <span />
        </div>
        {lines.map((line) => {
          const lineTotal = multiply(
            Number(line.quantity) || 0,
            Number(line.unitCost) || 0,
          );
          const hasReceipts = line.quantityReceived > 0;
          return (
            <div
              key={line.rowId}
              className="grid grid-cols-1 md:grid-cols-[1.5fr_1.5fr_1.8fr_0.7fr_0.55fr_0.85fr_0.95fr_auto] gap-2 items-start"
            >
              <CostCodePicker
                value={line.costCodeId}
                options={costCodes}
                seedDescription={line.description}
                onValueChange={(id) => updateLine(line.rowId, { costCodeId: id })}
              />
              {/* Split-PO job override — '' books to the PO's project. */}
              <select
                value={line.projectId === projectId ? '' : line.projectId}
                onChange={(e) =>
                  updateLine(line.rowId, { projectId: e.target.value })
                }
                title="Job this line's cost books to. Left on the PO's own project it follows the PO; pick another job to split this line off."
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
              >
                <option value="">
                  {poProjectLabel || "The PO's project"}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <Input
                value={line.description}
                onChange={(e) =>
                  updateLine(line.rowId, { description: e.target.value })
                }
                placeholder="Description"
              />
              <div className="space-y-0.5">
                <Input
                  value={line.quantity}
                  onChange={(e) =>
                    updateLine(line.rowId, { quantity: e.target.value })
                  }
                  inputMode="decimal"
                />
                {hasReceipts && (
                  <p className="text-[10px] text-slate-500 tabular-nums">
                    {line.quantityReceived} received
                  </p>
                )}
              </div>
              <Input
                value={line.unit}
                onChange={(e) => updateLine(line.rowId, { unit: e.target.value })}
                placeholder="ea"
              />
              <Input
                value={line.unitCost}
                onChange={(e) =>
                  updateLine(line.rowId, { unitCost: e.target.value })
                }
                inputMode="decimal"
              />
              <div className="flex items-center justify-end h-10 px-2 text-sm tabular-nums text-slate-900">
                {formatMoney(lineTotal)}
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={hasReceipts}
                title={
                  hasReceipts
                    ? 'Quantities were received against this line — adjust the qty instead of deleting.'
                    : undefined
                }
                onClick={() => removeLine(line.rowId)}
              >
                ×
              </Button>
            </div>
          );
        })}
        {err('lines') && <p className="text-xs text-red-600">{err('lines')}</p>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl">
        <div className="space-y-1.5">
          <Label>Tax</Label>
          <Input
            name="taxAmount"
            value={taxAmount}
            onChange={(e) => setTaxAmount(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Shipping</Label>
          <Input
            name="shipping"
            value={shipping}
            onChange={(e) => setShipping(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-500">Subtotal</Label>
          <div className="h-10 flex items-center px-3 text-sm tabular-nums">
            {formatMoney(totals.subtotal)}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-500">Total</Label>
          <div className="h-10 flex items-center px-3 text-sm font-semibold tabular-nums">
            {formatMoney(totals.total)}
          </div>
        </div>
      </div>

      <div className="space-y-1.5 max-w-2xl">
        <Label>Notes</Label>
        <textarea
          name="notes"
          rows={3}
          defaultValue={initial.notes}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save purchase order'}
      </Button>
    </form>
  );
}
