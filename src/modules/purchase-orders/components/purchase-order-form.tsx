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
import { ProjectPicker } from '@/modules/projects/components/project-picker';
import type { CustomerPickerOption } from '@/modules/customers/components/customer-picker';
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
import { CostCodePicker } from '@/modules/cost-codes/components/cost-code-picker';
import {
  SortableHeader,
  toggleSort,
  type SortState,
} from '@/components/ui/sortable-header';
import { sortLines } from '../line-sort';
import {
  PoLinesExcelImportDialog,
  type ImportedLine,
} from './po-lines-excel-import-dialog';
import { UpdateDefaultsDialog } from './update-defaults-dialog';
import { setInventoryItemDefaultsAction } from '@/modules/inventory/vendor-number-actions';

const initialState: CreatePurchaseOrderState = {};

type LineDraft = {
  rowId: string;
  inventoryItemId: string;
  costCodeId: string;
  /** Accounting category; '' = resolved at bill time (product → category → vendor). */
  accountingAccountId: string;
  /** Which fields the system filled in (shown with an "auto" tag until changed). */
  auto?: { costCode?: boolean; account?: boolean; unitCost?: boolean };
  /** Line-level job override; '' = the PO's project. */
  projectId: string;
  description: string;
  unit: string;
  quantity: string;
  unitCost: string;
};

type ProjectOption = { id: string; label: string };
type VendorOption = { id: string; label: string; defaultAccountId?: string | null };
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
    accountingAccountId: '',
    projectId: '',
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
    accountingAccountId?: string;
    projectId?: string;
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
  customers,
  costCodes,
  landedCosts,
  products,
  accounts = [],
  defaultNumber,
  defaults,
}: {
  /** Accounting categories a purchase can post to. */
  accounts?: Array<{ id: string; label: string }>;
  projects: ProjectOption[];
  vendors: VendorOption[];
  customers: CustomerPickerOption[];
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
        accountingAccountId: l.accountingAccountId ?? '',
        projectId: l.projectId ?? '',
        description: l.description,
        unit: l.unit,
        quantity: l.quantity,
        unitCost: l.unitCost,
      }));
    }
    return [newEmptyLine()];
  });
  const [sort, setSort] = useState<SortState>(null);
  const [taxAmount, setTaxAmount] = useState(defaults?.taxAmount ?? '0');
  const [shipping, setShipping] = useState(defaults?.shipping ?? '0');
  const [projectId, setProjectId] = useState<string>(defaults?.projectId ?? '');
  const [excelOpen, setExcelOpen] = useState(false);
  // Cost codes created inline via the picker, merged ahead of the loaded list
  // so a code added on one line is pickable on the others (and resolves for
  // default-cost inheritance + the update-defaults dialog).
  const [extraCostCodes, setExtraCostCodes] = useState<CostCodeOption[]>([]);
  const allCostCodes: CostCodeOption[] = useMemo(
    () => [...extraCostCodes, ...costCodes],
    [extraCostCodes, costCodes],
  );

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
        ? v.lines.map((l) => ({
            ...l,
            // Drafts saved before line-level jobs existed lack projectId.
            projectId: l.projectId ?? '',
            accountingAccountId: l.accountingAccountId ?? '',
            rowId: crypto.randomUUID(),
          }))
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
      accountingAccountId: '',
      projectId: '',
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

  // Shown in the per-line Job column so "same as the PO" names the actual job.
  const poProjectLabel = projects.find((p) => p.id === projectId)?.label ?? '';

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
    accountingAccountId: l.accountingAccountId,
    projectId: l.projectId,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity,
    unitCost: l.unitCost,
  }));

  const updateLine = (rowId: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l) => (l.rowId === rowId ? { ...l, ...patch } : l)));
  };

  // ----- Auto-fill (Olga, 2026-09-26): cost code, accounting category and
  // price fill themselves from the product → its category → the vendor.
  // Defaults saved from this form during the session override the loaded ones.
  const [savedDefaults, setSavedDefaults] = useState<
    Record<string, { costCodeId?: string; accountId?: string }>
  >({});
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const itemDefaults = (itemId: string) => {
    const p = productById.get(itemId);
    return {
      costCodeId: savedDefaults[itemId]?.costCodeId ?? p?.defaultCostCodeId ?? '',
      accountId:
        savedDefaults[itemId]?.accountId ?? p?.defaultAccountingAccountId ?? '',
    };
  };
  const vendorDefaultAccount = (vid: string) =>
    vendors.find((v) => v.id === vid)?.defaultAccountId ?? '';
  const lastPrice = (itemId: string, vid: string) =>
    productById.get(itemId)?.lastPrices?.find((lp) => lp.vendorId === vid)?.unitCost ??
    null;

  // A new vendor refreshes whatever the system filled (never a hand entry):
  // the vendor's default category on product-less lines, and last prices.
  useEffect(() => {
    if (!vendorId) return;
    setLines((prev) =>
      prev.map((l) => {
        const next = { ...l, auto: { ...l.auto } };
        const itemAccount = l.inventoryItemId ? itemDefaults(l.inventoryItemId).accountId : '';
        if ((l.accountingAccountId === '' || l.auto?.account) && !itemAccount) {
          const acct = vendorDefaultAccount(vendorId);
          if (acct) {
            next.accountingAccountId = acct;
            next.auto!.account = true;
          }
        }
        if (l.inventoryItemId && l.auto?.unitCost) {
          const lp = lastPrice(l.inventoryItemId, vendorId);
          if (lp !== null) next.unitCost = String(lp);
        }
        return next;
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  async function saveItemDefault(
    itemId: string,
    patch: { costCodeId?: string; accountId?: string },
  ) {
    const res = await setInventoryItemDefaultsAction({ itemId, ...patch });
    if (res.ok) {
      setSavedDefaults((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
    }
  }

  // New lines land at the TOP so a long PO doesn't mean scrolling to the
  // bottom after every "+ Add line"; adding clears any sort so the new row
  // is visibly first.
  const addLine = () => {
    setSort(null);
    const acct = vendorDefaultAccount(vendorId);
    setLines((prev) => [
      acct
        ? { ...newEmptyLine(), accountingAccountId: acct, auto: { account: true } }
        : newEmptyLine(),
      ...prev,
    ]);
  };

  // Manual reorder — line the rows up with the supplier's own PO for easy
  // side-by-side comparison. Clears the sort indicator (the hand-made
  // order IS the order) and persists as sort_order on create.
  const moveLine = (rowId: string, dir: -1 | 1) => {
    setSort(null);
    setLines((prev) => {
      const i = prev.findIndex((l) => l.rowId === rowId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  // Sorting reorders the draft rows, so the order on screen is the order
  // the PO is created with.
  const onSort = (key: string) => {
    const next = toggleSort(sort, key);
    setSort(next);
    setLines((prev) =>
      sortLines(prev, next, (l) => ({
        description: l.description,
        unit: l.unit,
        quantity: Number(l.quantity) || 0,
        unitCost: Number(l.unitCost) || 0,
      })),
    );
  };

  const onCostCodeChange = (rowId: string, costCodeId: string) => {
    const code = allCostCodes.find((c) => c.id === costCodeId);
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
          auto: { ...l.auto, costCode: false },
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

        {/* The header project is the DEFAULT job, not the only one — each line
            can be pointed at a different job in its own Job column. */}
        <Field
          label="Project (default job for the lines)"
          error={err('projectId')}
          required
        >
          <ProjectPicker
            name="projectId"
            required
            allowNone={false}
            value={projectId}
            projects={projects.map((p) => ({ id: p.id, name: p.label }))}
            customers={customers}
            onChange={(id) => setProjectId(id)}
            placeholder={
              projects.length === 0 ? 'No projects yet' : 'Select a project'
            }
          />
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
        <legend className="px-2 text-sm font-medium text-slate-700">
          Line items ({lines.length})
        </legend>

        {err('lines') && <p className="text-xs text-red-600">{err('lines')}</p>}

        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.7fr)_minmax(0,0.7fr)_minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,0.95fr)_auto] gap-2 px-1 text-xs font-medium text-slate-500">
            <span>Product</span>
            <span>Cost code</span>
            <span>Category</span>
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
            return (
              <div
                key={line.rowId}
                className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.7fr)_minmax(0,0.7fr)_minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,0.95fr)_auto] gap-2 items-start"
              >
                <ProductPicker
                  value={line.inventoryItemId}
                  options={products}
                  vendorId={vendorId}
                  defaultNewName={line.description}
                  onItemSelected={(picked) => {
                    if (!picked) {
                      updateLine(line.rowId, { inventoryItemId: '' });
                      return;
                    }
                    // Price: last paid to THIS vendor, else the product's
                    // default, else the cost code's — only into an empty or
                    // system-filled price, never over a typed one.
                    const defs = itemDefaults(picked.id);
                    const priceIsFree =
                      (Number(line.unitCost) || 0) === 0 || line.auto?.unitCost;
                    const lp = vendorId ? lastPrice(picked.id, vendorId) : null;
                    const costCodeRow = allCostCodes.find(
                      (c) => c.id === (defs.costCodeId || line.costCodeId),
                    );
                    const price =
                      lp ??
                      (picked.defaultCost > 0
                        ? picked.defaultCost
                        : costCodeRow?.defaultCost != null && costCodeRow.defaultCost > 0
                          ? costCodeRow.defaultCost
                          : null);
                    const codeIsFree = line.costCodeId === '' || line.auto?.costCode;
                    const acctIsFree = line.accountingAccountId === '' || line.auto?.account;
                    const account = defs.accountId || vendorDefaultAccount(vendorId);
                    updateLine(line.rowId, {
                      inventoryItemId: picked.id,
                      ...(codeIsFree && defs.costCodeId ? { costCodeId: defs.costCodeId } : {}),
                      ...(acctIsFree && account ? { accountingAccountId: account } : {}),
                      ...(priceIsFree && price !== null ? { unitCost: String(price) } : {}),
                      auto: {
                        costCode:
                          codeIsFree && defs.costCodeId ? true : line.auto?.costCode && codeIsFree,
                        account: acctIsFree && account ? true : line.auto?.account && acctIsFree,
                        unitCost: priceIsFree && price !== null ? true : false,
                      },
                      description:
                        line.description.trim() === '' ? picked.name : line.description,
                      unit:
                        line.unit.trim() === '' && picked.unit
                          ? picked.unit
                          : line.unit,
                    });
                  }}
                />
                <div className="min-w-0">
                <CostCodePicker
                  value={line.costCodeId}
                  options={allCostCodes}
                  seedDescription={line.description}
                  onValueChange={(id) => onCostCodeChange(line.rowId, id)}
                  onCreated={(item) =>
                    setExtraCostCodes((prev) => [
                      {
                        id: item.id,
                        code: item.code,
                        description: item.description,
                        defaultCost: item.defaultCost,
                      },
                      ...prev,
                    ])
                  }
                />
                {line.auto?.costCode && line.costCodeId && <AutoTag />}
                {(() => {
                  if (!line.inventoryItemId || !line.costCodeId) return null;
                  const expected = itemDefaults(line.inventoryItemId).costCodeId;
                  if (expected === line.costCodeId) return null;
                  const code = allCostCodes.find((c) => c.id === expected)?.code;
                  const chosen = allCostCodes.find((c) => c.id === line.costCodeId)?.code;
                  return (
                    <p className="mt-0.5 text-[11px] text-amber-700">
                      {expected ? `⚠ Usually ${code ?? 'another code'}. ` : ''}
                      <button
                        type="button"
                        className="underline"
                        onClick={() =>
                          void saveItemDefault(line.inventoryItemId, {
                            costCodeId: line.costCodeId,
                          })
                        }
                      >
                        Make {chosen ?? 'this'} the product&apos;s default
                      </button>
                    </p>
                  );
                })()}
                </div>
                <div className="min-w-0">
                  <select
                    value={line.accountingAccountId}
                    onChange={(e) =>
                      updateLine(line.rowId, {
                        accountingAccountId: e.target.value,
                        auto: { ...line.auto, account: false },
                      })
                    }
                    title="Accounting category this line's cost posts to"
                    className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
                  >
                    <option value="">Auto (product → vendor)</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  {line.auto?.account && line.accountingAccountId && <AutoTag />}
                  {(() => {
                    if (!line.inventoryItemId || !line.accountingAccountId) return null;
                    const expected = itemDefaults(line.inventoryItemId).accountId;
                    if (expected === line.accountingAccountId) return null;
                    const label = accounts.find((a) => a.id === expected)?.label;
                    return (
                      <p className="mt-0.5 text-[11px] text-amber-700">
                        {expected ? `⚠ Usually ${label ?? 'another category'}. ` : ''}
                        <button
                          type="button"
                          className="underline"
                          onClick={() =>
                            void saveItemDefault(line.inventoryItemId, {
                              accountId: line.accountingAccountId,
                            })
                          }
                        >
                          Make this the product&apos;s default
                        </button>
                      </p>
                    );
                  })()}
                </div>
                {/* Split-PO job override: this line's cost books to the
                    selected job instead of the PO's project — one order,
                    many jobs (50 rolls to A, 50 to B). */}
                <select
                  value={line.projectId}
                  onChange={(e) =>
                    updateLine(line.rowId, { projectId: e.target.value })
                  }
                  title="Job this line's cost books to. Left on the PO's own project it follows the PO; pick another job to split this line off."
                  className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
                >
                  <option value="">
                    {poProjectLabel || "The PO's project"}
                  </option>
                  {projects.map((pOpt) => (
                    <option key={pOpt.id} value={pOpt.id}>
                      {pOpt.label}
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
                      updateLine(line.rowId, {
                        unitCost: e.target.value,
                        auto: { ...line.auto, unitCost: false },
                      })
                    }
                    inputMode="decimal"
                  />
                  {line.auto?.unitCost && (
                    <AutoTag
                      title={
                        vendorId && lastPrice(line.inventoryItemId, vendorId) !== null
                          ? 'Last price paid to this vendor'
                          : 'Product default cost'
                      }
                    />
                  )}
                  {/* "Update defaults" link appears only when the entered cost
                      differs from the linked product / cost code's standing
                      default. Two-checkbox confirm dialog requires explicit
                      consent for each target. */}
                  {(() => {
                    const product = products.find((p) => p.id === line.inventoryItemId);
                    const code = allCostCodes.find((c) => c.id === line.costCodeId);
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
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={lines.findIndex((x) => x.rowId === line.rowId) === 0}
                    onClick={() => moveLine(line.rowId, -1)}
                    title="Move this line up"
                    className="h-8 w-6 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={
                      lines.findIndex((x) => x.rowId === line.rowId) ===
                      lines.length - 1
                    }
                    onClick={() => moveLine(line.rowId, 1)}
                    title="Move this line down"
                    className="h-8 w-6 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    ↓
                  </button>
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
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addLine}
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
        vendorId={vendorId}
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

/** Marks a value the system filled in; editing the field removes it. */
function AutoTag({ title }: { title?: string }) {
  return (
    <span
      className="mt-0.5 inline-block rounded bg-blue-50 px-1 text-[10px] font-medium uppercase tracking-wide text-blue-700"
      title={title ?? 'Filled in automatically — change it to override'}
    >
      auto
    </span>
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
