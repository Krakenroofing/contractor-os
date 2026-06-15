'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useUnsavedChangesGuard } from '@/lib/use-unsaved-changes-guard';
import {
  loadDraft,
  saveDraft,
  clearDraft,
  formatDraftTime,
} from '@/lib/form-draft';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { VendorPicker } from '@/modules/vendors/components/vendor-picker';
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
import { UpdateDefaultsDialog } from './update-defaults-dialog';

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
// Phase 2 cost-code defaultCost: surface here so the line picker can fall
// back to it when the linked inventory item has no defaultCost (or no
// inventory item is linked at all — labor / one-off / services).
type CostCodeOption = {
  id: string;
  code: string;
  description: string;
  defaultCost: number | null;
};
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

// Local "Save draft" (Path 1) — stash the whole in-progress PO in
// localStorage so leaving doesn't wipe it. Per-browser, not a server record.
const DRAFT_KEY = 'kops:po-manual-draft';

type PoManualDraft = {
  number: string;
  status: string;
  vendorId: string;
  projectId: string;
  landedCostEntryId: string;
  issueDate: string;
  expectedDeliveryDate: string;
  taxAmount: string;
  shipping: string;
  notes: string;
  lines: LineDraft[];
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
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty);
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

  // Header fields are controlled so a saved draft can fully restore them.
  const [poNumber, setPoNumber] = useState(defaultNumber);
  const [status, setStatus] = useState<string>('draft');
  const [vendorId, setVendorId] = useState<string>(defaults?.vendorId ?? '');
  const [landedCostEntryId, setLandedCostEntryId] = useState<string>(
    defaults?.landedCostEntryId ?? '',
  );
  const [issueDate, setIssueDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>(
    () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return d.toISOString().slice(0, 10);
    },
  );
  const [notes, setNotes] = useState<string>(defaults?.notes ?? '');

  // Local Save-draft / Resume (Path 1).
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [resumeAvailableAt, setResumeAvailableAt] = useState<number | null>(
    null,
  );
  useEffect(() => {
    const d = loadDraft<PoManualDraft>(DRAFT_KEY);
    if (d) setResumeAvailableAt(d.savedAt);
  }, []);

  function saveDraftNow() {
    const at = saveDraft<PoManualDraft>(DRAFT_KEY, {
      number: poNumber,
      status,
      vendorId,
      projectId,
      landedCostEntryId,
      issueDate,
      expectedDeliveryDate,
      taxAmount,
      shipping,
      notes,
      lines,
    });
    if (at !== null) {
      setDraftSavedAt(at);
      setDirty(false);
    }
  }

  function resumeDraft() {
    const d = loadDraft<PoManualDraft>(DRAFT_KEY);
    if (!d) return;
    const v = d.data;
    setPoNumber(v.number);
    setStatus(v.status);
    setVendorId(v.vendorId);
    setProjectId(v.projectId);
    setLandedCostEntryId(v.landedCostEntryId);
    setIssueDate(v.issueDate);
    setExpectedDeliveryDate(v.expectedDeliveryDate);
    setTaxAmount(v.taxAmount);
    setShipping(v.shipping);
    setNotes(v.notes);
    setLines(
      v.lines.length > 0
        ? v.lines.map((l) => ({ ...l, rowId: crypto.randomUUID() }))
        : [newEmptyLine()],
    );
    setResumeAvailableAt(null);
    setDraftSavedAt(null);
    setDirty(false);
  }

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
      prev.map((l) => {
        if (l.rowId !== rowId) return l;
        // Inheritance: if this line still has no unitCost set, fall back to
        // the cost code's defaultCost. Only when the line is also unlinked
        // from an inventory item (so we don't override an item-driven price).
        const nextUnitCost =
          (Number(l.unitCost) || 0) === 0 &&
          l.inventoryItemId === '' &&
          code?.defaultCost != null &&
          code.defaultCost > 0
            ? String(code.defaultCost)
            : l.unitCost;
        return {
          ...l,
          costCodeId,
          description:
            l.description.trim() === '' && code ? code.description : l.description,
          unitCost: nextUnitCost,
        };
      }),
    );
  };

  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form
      action={formAction}
      onInput={() => {
        setDirty(true);
        setDraftSavedAt(null);
      }}
      className="space-y-6"
    >
      {resumeAvailableAt !== null && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>
            You have a saved PO draft from {formatDraftTime(resumeAvailableAt)}.
          </span>
          <span className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={resumeDraft}>
              Resume draft
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                clearDraft(DRAFT_KEY);
                setResumeAvailableAt(null);
              }}
            >
              Discard
            </Button>
          </span>
        </div>
      )}
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      <input type="hidden" name="lines" value={JSON.stringify(linesPayload)} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="PO number" error={err('number')} required>
          <Input
            name="number"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            required
          />
        </Field>

        <Field label="Status" error={err('status')}>
          <Select
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {poStatusValues.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Vendor" error={err('vendorId')} required>
          <VendorPicker
            name="vendorId"
            required
            allowNone={false}
            value={vendorId}
            vendors={vendors.map((v) => ({ id: v.id, name: v.label }))}
            onChange={(id) => setVendorId(id)}
          />
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
          <Select
            name="landedCostEntryId"
            value={landedCostEntryId}
            onChange={(e) => setLandedCostEntryId(e.target.value)}
          >
            <option value="">— None —</option>
            {filteredLandedCosts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Order date" error={err('issueDate')}>
          <Input
            name="issueDate"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
        </Field>

        <Field label="Expected delivery" error={err('expectedDeliveryDate')}>
          <Input
            name="expectedDeliveryDate"
            type="date"
            value={expectedDeliveryDate}
            onChange={(e) => setExpectedDeliveryDate(e.target.value)}
          />
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
                  defaultNewName={line.description}
                  onItemSelected={(picked) => {
                    if (!picked) {
                      updateLine(line.rowId, { inventoryItemId: '' });
                      return;
                    }
                    // Inheritance chain for unitCost when the line is still
                    // empty: inventory item > cost code > leave zero.
                    const costCodeRow = costCodes.find(
                      (c) => c.id === line.costCodeId,
                    );
                    const fallbackFromCostCode =
                      costCodeRow?.defaultCost != null && costCodeRow.defaultCost > 0
                        ? String(costCodeRow.defaultCost)
                        : '';
                    const nextUnitCost =
                      (Number(line.unitCost) || 0) === 0
                        ? picked.defaultCost > 0
                          ? picked.defaultCost.toString()
                          : fallbackFromCostCode || line.unitCost
                        : line.unitCost;
                    updateLine(line.rowId, {
                      inventoryItemId: picked.id,
                      description:
                        line.description.trim() === '' ? picked.name : line.description,
                      unit:
                        line.unit.trim() === '' && picked.unit
                          ? picked.unit
                          : line.unit,
                      unitCost: nextUnitCost,
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
                <div className="space-y-1">
                  <Input
                    value={line.unitCost}
                    onChange={(e) =>
                      updateLine(line.rowId, { unitCost: e.target.value })
                    }
                    inputMode="decimal"
                  />
                  {/* "Update defaults" link appears only when the entered cost
                      differs from the linked product / cost code's standing
                      default. Two-checkbox confirm dialog requires explicit
                      consent for each target. */}
                  {(() => {
                    const product = products.find((p) => p.id === line.inventoryItemId);
                    const code = costCodes.find((c) => c.id === line.costCodeId);
                    const itemForDialog = product
                      ? {
                          id: product.id,
                          name: product.name,
                          currentDefaultCost: product.defaultCost,
                        }
                      : null;
                    const codeForDialog = code
                      ? {
                          id: code.id,
                          code: code.code,
                          description: code.description,
                          currentDefaultCost: code.defaultCost,
                        }
                      : null;
                    return (
                      <UpdateDefaultsDialog
                        unitCost={line.unitCost}
                        inventoryItem={itemForDialog}
                        costCode={codeForDialog}
                      />
                    );
                  })()}
                </div>
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
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={pending}
          onClick={() => clearDraft(DRAFT_KEY)}
        >
          {pending ? 'Creating…' : 'Create purchase order'}
        </Button>
        <Button type="button" variant="outline" onClick={saveDraftNow}>
          Save draft
        </Button>
        <Link href="/purchase-orders">
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
        {draftSavedAt !== null && (
          <span className="text-xs text-emerald-700">
            ✓ Draft saved {formatDraftTime(draftSavedAt)} — safe to leave and
            resume later.
          </span>
        )}
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
