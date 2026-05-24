'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { calcPOTotals, formatMoney, multiply } from '@/lib/money';
import {
  createPurchaseOrderAction,
  type CreatePurchaseOrderState,
} from '../actions';
import { poStatusValues, STATUS_LABEL } from '../schema';
import {
  ProductPicker,
  type ProductPickerOption,
} from '@/modules/inventory/components/product-picker';
import {
  PoLinesExcelImportDialog,
  type ImportedLine,
} from './po-lines-excel-import-dialog';

const initialState: CreatePurchaseOrderState = {};

type LineDraft = {
  rowId: string;
  inventoryItemId: string;
  costCodeId: string;
  description: string;
  unit: string;
  quantity: string;
  unitCost: string;
};

type ProjectOption = { id: string; label: string };
type VendorOption = { id: string; label: string };
type CostCodeOption = { id: string; code: string; description: string };
export type LandedCostOption = { id: string; label: string; projectId: string | null };

function newEmptyLine(): LineDraft {
  return {
    rowId: crypto.randomUUID(),
    inventoryItemId: '',
    costCodeId: '',
    description: '',
    unit: '',
    quantity: '0',
    unitCost: '0',
  };
}

export type PurchaseOrderFormDefaults = {
  vendorId?: string;
  projectId?: string;
  landedCostEntryId?: string;
  notes?: string;
  taxAmount?: string;
  shipping?: string;
  lines?: Array<{
    inventoryItemId: string;
    costCodeId: string;
    description: string;
    unit: string;
    quantity: string;
    unitCost: string;
  }>;
};

export function PurchaseOrderForm({
  projects,
  vendors,
  costCodes,
  landedCosts,
  products,
  defaultNumber,
  defaults,
}: {
  projects: ProjectOption[];
  vendors: VendorOption[];
  costCodes: CostCodeOption[];
  landedCosts: LandedCostOption[];
  products: ProductPickerOption[];
  defaultNumber: string;
  defaults?: PurchaseOrderFormDefaults;
}) {
  const [state, formAction, pending] = useActionState(
    createPurchaseOrderAction,
    initialState,
  );
  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (defaults?.lines && defaults.lines.length > 0) {
      return defaults.lines.map((l) => ({
        rowId: crypto.randomUUID(),
        inventoryItemId: l.inventoryItemId,
        costCodeId: l.costCodeId,
        description: l.description,
        unit: l.unit,
        quantity: l.quantity,
        unitCost: l.unitCost,
      }));
    }
    return [newEmptyLine()];
  });
  const [taxAmount, setTaxAmount] = useState(defaults?.taxAmount ?? '0');
  const [shipping, setShipping] = useState(defaults?.shipping ?? '0');
  const [projectId, setProjectId] = useState<string>(defaults?.projectId ?? '');
  const [excelOpen, setExcelOpen] = useState(false);

  // A line is "empty" if the user hasn't touched it — no product, no cost
  // code, no description, no qty/cost. When importing from Excel we replace
  // the placeholder line if it's still empty, else append.
  const isEmptyLine = (l: LineDraft) =>
    l.inventoryItemId === '' &&
    l.costCodeId === '' &&
    l.description.trim() === '' &&
    (Number(l.quantity) || 0) === 0 &&
    (Number(l.unitCost) || 0) === 0;

  function appendImported(imported: ImportedLine[]) {
    const newRows: LineDraft[] = imported.map((l) => ({
      rowId: crypto.randomUUID(),
      inventoryItemId: l.inventoryItemId,
      costCodeId: l.costCodeId,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unitCost: l.unitCost,
    }));
    setLines((prev) => {
      const kept = prev.filter((l) => !isEmptyLine(l));
      return [...kept, ...newRows];
    });
  }

  const filteredLandedCosts = projectId
    ? landedCosts.filter((l) => l.projectId === projectId || l.projectId === null)
    : landedCosts;

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
  const subtotal = totals.subtotal;
  const tax = totals.taxAmount;
  const ship = totals.shipping;
  const total = totals.total;

  const linesPayload = lines.map((l) => ({
    costCodeId: l.costCodeId,
    inventoryItemId: l.inventoryItemId,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity,
    unitCost: l.unitCost,
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
              description:
                l.description.trim() === '' && code ? code.description : l.description,
            }
          : l,
      ),
    );
  };

  const err = (key: string) => state.errors?.[key]?.[0];

  const today = new Date().toISOString().slice(0, 10);
  const defaultDelivery = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      <input type="hidden" name="lines" value={JSON.stringify(linesPayload)} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="PO number" error={err('number')} required>
          <Input name="number" defaultValue={defaultNumber} required />
        </Field>

        <Field label="Status" error={err('status')}>
          <Select name="status" defaultValue="draft">
            {poStatusValues.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Vendor" error={err('vendorId')} required>
          <Select name="vendorId" required defaultValue={defaults?.vendorId ?? ''}>
            <option value="" disabled>
              {vendors.length === 0 ? 'No vendors yet' : 'Select a vendor'}
            </option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Project" error={err('projectId')} required>
          <Select
            name="projectId"
            required
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="" disabled>
              {projects.length === 0 ? 'No projects yet' : 'Select a project'}
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Linked landed-cost entry (optional)"
          error={err('landedCostEntryId')}
        >
          <Select name="landedCostEntryId" defaultValue={defaults?.landedCostEntryId ?? ''}>
            <option value="">— None —</option>
            {filteredLandedCosts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Order date" error={err('issueDate')}>
          <Input name="issueDate" type="date" defaultValue={today} />
        </Field>

        <Field label="Expected delivery" error={err('expectedDeliveryDate')}>
          <Input name="expectedDeliveryDate" type="date" defaultValue={defaultDelivery} />
        </Field>
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-3">
        <legend className="px-2 text-sm font-medium text-slate-700">Line items</legend>

        {err('lines') && <p className="text-xs text-red-600">{err('lines')}</p>}

        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-[1.6fr_1.4fr_2fr_0.8fr_0.6fr_0.9fr_1fr_auto] gap-2 px-1 text-xs font-medium text-slate-500">
            <span>Product</span>
            <span>Cost code</span>
            <span>Description</span>
            <span>Qty</span>
            <span>Unit</span>
            <span>Unit cost</span>
            <span className="text-right">Line total</span>
            <span />
          </div>

          {lines.map((line) => {
            const lineTotal = multiply(
              Number(line.quantity) || 0,
              Number(line.unitCost) || 0,
            );
            return (
              <div
                key={line.rowId}
                className="grid grid-cols-1 md:grid-cols-[1.6fr_1.4fr_2fr_0.8fr_0.6fr_0.9fr_1fr_auto] gap-2 items-start"
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
                  onChange={(e) =>
                    updateLine(line.rowId, { description: e.target.value })
                  }
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
                <div className="flex items-center justify-end h-10 px-2 text-sm tabular-nums text-slate-900">
                  {formatMoney(lineTotal)}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setLines((prev) => prev.filter((l) => l.rowId !== line.rowId))
                  }
                  disabled={lines.length === 1}
                  aria-label="Remove line"
                >
                  ✕
                </Button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((prev) => [...prev, newEmptyLine()])}
          >
            + Add line
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setExcelOpen(true)}
          >
            Upload from Excel
          </Button>
        </div>
      </fieldset>

      <PoLinesExcelImportDialog
        open={excelOpen}
        onClose={() => setExcelOpen(false)}
        products={products}
        costCodes={costCodes}
        onInsert={appendImported}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Tax" error={err('taxAmount')}>
          <Input
            name="taxAmount"
            inputMode="decimal"
            value={taxAmount}
            onChange={(e) => setTaxAmount(e.target.value)}
          />
        </Field>
        <Field label="Freight / duty" error={err('shipping')}>
          <Input
            name="shipping"
            inputMode="decimal"
            value={shipping}
            onChange={(e) => setShipping(e.target.value)}
          />
        </Field>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 grid grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Subtotal</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {formatMoney(subtotal)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Tax</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {formatMoney(tax)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Freight</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {formatMoney(ship)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {formatMoney(total)}
          </p>
        </div>
      </div>

      <Field label="Notes" error={err('notes')}>
        <textarea
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="Delivery instructions, ship-to override, etc."
          defaultValue={defaults?.notes ?? ''}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create purchase order'}
        </Button>
        <Link href="/purchase-orders">
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
