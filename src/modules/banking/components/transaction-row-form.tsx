'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  updateImportedTransactionAction,
  type BankingActionState,
} from '../actions';
import {
  deleteManualTransactionAction,
  updateManualTransactionAction,
  type ReconcileActionState,
} from '../reconcile-actions';
import {
  AccountingAccountPicker,
  type AccountingAccountOption,
} from '@/modules/accounting/components/accounting-account-picker';
import { computeVatSplit, round2 } from '../lib/vat-split';
import {
  VendorPicker,
  type VendorPickerOption,
} from '@/modules/vendors/components/vendor-picker';
import { CostCodePicker } from '@/modules/cost-codes/components/cost-code-picker';
import { ProjectPicker } from '@/modules/projects/components/project-picker';
import type { CustomerPickerOption } from '@/modules/customers/components/customer-picker';

type Option = { id: string; label: string };

type VendorOption = {
  id: string;
  label: string;
  defaultAccountingAccountId: string | null;
  vatRatePercent: number | null;
};

// A split line as the operator is editing it. `amount` is the raw text in the
// number input ('' allowed mid-edit); serialized to a number on submit.
type LineDraft = {
  accountingAccountId: string;
  projectId: string;
  costCodeId: string;
  description: string;
  amount: string;
};

type InitialLine = {
  accountingAccountId: string | null;
  projectId: string | null;
  costCodeId: string | null;
  description: string | null;
  amount: number;
};

export type TransactionRowFormProps = {
  id: string;
  initial: {
    accountingAccountId: string | null;
    projectId: string | null;
    costCodeId: string | null;
    vendorId: string | null;
    isReviewed: boolean;
    isIgnored: boolean;
    notes: string | null;
    lines: InitialLine[];
  };
  grossAmount: number;
  currency: string;
  categories: AccountingAccountOption[];
  projects: Option[];
  costCodes: Option[];
  vendors: VendorOption[];
  customers: CustomerPickerOption[];
  vatInputAccountId: string | null;
  /** Company standard VAT rate (e.g. 10 for TRB). Used as the fallback rate
   *  for Auto-VAT split when no VAT-registered vendor is selected, so a txn
   *  can be split at the company rate and categorized later. */
  companyVatRatePercent: number | null;
  canEdit: boolean;
  /** True for register/reconcile entries typed by the operator (source
   *  "Manual entry"). Only these get Edit/Delete buttons — imported
   *  statement rows mirror the bank and must stay. */
  isManualEntry?: boolean;
  /** The manual entry's own fields, for the inline editor (typo fixes:
   *  wrong amount / date / description / direction). */
  manualInitial?: {
    transactionDate: string;
    description: string;
    /** Signed: negative = money out. */
    amount: number;
  };
};

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(n);
  } catch {
    return n.toFixed(2);
  }
}


const emptyLine = (): LineDraft => ({
  accountingAccountId: '',
  projectId: '',
  costCodeId: '',
  description: '',
  amount: '',
});

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 mb-1">
    {children}
  </span>
);

// Inline editor rendered under each transaction row. Submits to the server
// action with hidden id. Supports a single category OR a QuickBooks-style
// split into multiple category lines (one of which can be VAT Input).
export function TransactionRowForm(props: TransactionRowFormProps) {
  const [state, action, pending] = useActionState<BankingActionState, FormData>(
    updateImportedTransactionAction,
    {},
  );
  const router = useRouter();
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Inline editor for manual entries (typo fixes). Not a nested <form> —
  // this whole row already lives inside one — so it builds the FormData by
  // hand and calls the server action directly.
  const [editingEntry, setEditingEntry] = useState(false);
  const [entryDate, setEntryDate] = useState(
    props.manualInitial?.transactionDate ?? '',
  );
  const [entryDesc, setEntryDesc] = useState(
    props.manualInitial?.description ?? '',
  );
  const [entryDirection, setEntryDirection] = useState<'out' | 'in'>(
    (props.manualInitial?.amount ?? -1) < 0 ? 'out' : 'in',
  );
  const [entryAmount, setEntryAmount] = useState(
    props.manualInitial ? Math.abs(props.manualInitial.amount).toFixed(2) : '',
  );
  const [savingEntry, startSaveEntry] = useTransition();
  const [entryError, setEntryError] = useState<string | null>(null);

  function saveEntry() {
    setEntryError(null);
    const fd = new FormData();
    fd.set('transactionId', props.id);
    fd.set('transactionDate', entryDate);
    fd.set('description', entryDesc);
    fd.set('direction', entryDirection);
    fd.set('amount', entryAmount);
    startSaveEntry(async () => {
      const res: ReconcileActionState = await updateManualTransactionAction(
        {},
        fd,
      );
      if (res.formError) {
        setEntryError(res.formError);
        return;
      }
      setEditingEntry(false);
      router.refresh();
    });
  }

  function deleteEntry() {
    if (
      !window.confirm(
        'Delete this manually added transaction? This cannot be undone.',
      )
    ) {
      return;
    }
    setDeleteError(null);
    startDelete(async () => {
      const res = await deleteManualTransactionAction(props.id);
      if (res.formError) {
        setDeleteError(res.formError);
        return;
      }
      router.refresh();
    });
  }
  const [accountingAccountId, setAccountingAccountId] = useState(
    props.initial.accountingAccountId ?? '',
  );
  const [projectId, setProjectId] = useState(props.initial.projectId ?? '');
  const [costCodeId, setCostCodeId] = useState(props.initial.costCodeId ?? '');
  const [vendorId, setVendorId] = useState(props.initial.vendorId ?? '');
  const [isReviewed, setIsReviewed] = useState(props.initial.isReviewed);
  const [isIgnored, setIsIgnored] = useState(props.initial.isIgnored);
  const [notes, setNotes] = useState(props.initial.notes ?? '');

  const [split, setSplit] = useState(props.initial.lines.length > 0);
  const [lines, setLines] = useState<LineDraft[]>(
    props.initial.lines.length > 0
      ? props.initial.lines.map((l) => ({
          accountingAccountId: l.accountingAccountId ?? '',
          projectId: l.projectId ?? '',
          costCodeId: l.costCodeId ?? '',
          description: l.description ?? '',
          amount: l.amount.toFixed(2),
        }))
      : [emptyLine(), emptyLine()],
  );

  // Picking a vendor prefills the (single) category from its default when the
  // operator hasn't already chosen one — never overwrites an existing pick.
  // The picked option is passed through (so a just-created vendor works too).
  function onVendorChange(nextVendorId: string, vendor?: VendorPickerOption) {
    setVendorId(nextVendorId);
    if (!accountingAccountId && vendor?.defaultAccountingAccountId) {
      setAccountingAccountId(vendor.defaultAccountingAccountId);
    }
  }

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i: number) =>
    setLines((prev) => prev.filter((_, idx) => idx !== i));

  const selectedVendor = props.vendors.find((x) => x.id === vendorId);
  // Rate resolution mirrors the rule engine: vendor rate first, then the
  // company standard rate. So a TRB transaction splits at 10% even with no
  // vendor picked — the operator can categorize the net line afterward.
  const effectiveVatRate =
    (selectedVendor?.vatRatePercent ?? 0) > 0
      ? selectedVendor!.vatRatePercent!
      : (props.companyVatRatePercent ?? 0);
  const canAutoVat = Boolean(effectiveVatRate && props.vatInputAccountId);

  // Fill the grid with the cost + VAT Input split derived from the resolved
  // rate. The cost line is left UNCATEGORIZED unless a category / vendor
  // default is already set — the operator assigns it later.
  function autoVatSplit() {
    const rate = effectiveVatRate;
    if (!rate || !props.vatInputAccountId) return;
    const gross = props.grossAmount;
    const { net, vat } = computeVatSplit(gross, rate);
    const costAccount =
      accountingAccountId || selectedVendor?.defaultAccountingAccountId || '';
    setLines([
      {
        accountingAccountId: costAccount,
        projectId,
        costCodeId,
        description: 'Cost (ex-VAT)',
        amount: net.toFixed(2),
      },
      {
        accountingAccountId: props.vatInputAccountId,
        projectId: '',
        costCodeId: '',
        description: `VAT input @ ${rate}%`,
        amount: vat.toFixed(2),
      },
    ]);
  }

  const linesTotal = round2(
    lines.reduce((s, l) => s + (Number(l.amount) || 0), 0),
  );
  const remaining = round2(props.grossAmount - linesTotal);
  const balanced = Math.abs(remaining) < 0.005;

  const linesJson = JSON.stringify(
    lines.map((l) => ({
      accountingAccountId: l.accountingAccountId,
      projectId: l.projectId || null,
      costCodeId: l.costCodeId || null,
      description: l.description || null,
      amount: Number(l.amount) || 0,
    })),
  );

  if (!props.canEdit) {
    return (
      <div className="text-xs text-slate-500 italic">
        View-only role — no edits permitted.
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={props.id} />
      <input type="hidden" name="split" value={split ? 'true' : ''} />
      <input type="hidden" name="linesJson" value={linesJson} />

      {/* Vendor + (single category OR "itemized" note) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
        <div className="md:col-span-3">
          <FieldLabel>
            Payee / Vendor{' '}
            <span className="normal-case text-slate-400">(optional)</span>
          </FieldLabel>
          <VendorPicker
            name="vendorId"
            value={vendorId}
            vendors={props.vendors.map((o) => ({
              id: o.id,
              name: o.label,
              defaultAccountingAccountId: o.defaultAccountingAccountId,
              vatRatePercent: o.vatRatePercent,
            }))}
            onChange={onVendorChange}
          />
        </div>

        {!split ? (
          <>
            <div className="md:col-span-3">
              <FieldLabel>Category</FieldLabel>
              <AccountingAccountPicker
                name="accountingAccountId"
                value={accountingAccountId}
                onChange={setAccountingAccountId}
                accounts={props.categories}
                placeholder="— select category —"
              />
            </div>
            <div className="md:col-span-3">
              <FieldLabel>
                Project{' '}
                <span className="normal-case text-slate-400">(optional)</span>
              </FieldLabel>
              <ProjectPicker
                name="projectId"
                value={projectId}
                projects={props.projects.map((o) => ({ id: o.id, name: o.label }))}
                customers={props.customers}
                noneLabel="— no project —"
                onChange={(id) => setProjectId(id)}
              />
            </div>
            <div className="md:col-span-3">
              <FieldLabel>
                Cost code{' '}
                <span className="normal-case text-slate-400">(optional)</span>
              </FieldLabel>
              <CostCodePicker
                name="costCodeId"
                value={costCodeId}
                options={props.costCodes}
                emptyLabel="— no cost code —"
                onValueChange={setCostCodeId}
              />
            </div>
          </>
        ) : (
          <div className="md:col-span-9 flex items-end text-xs text-slate-500">
            Itemized into {lines.length} line{lines.length === 1 ? '' : 's'} below
            — category &amp; project are set per line.
          </div>
        )}
      </div>

      {/* Split toggle + Auto-VAT */}
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={split}
            onChange={(e) => setSplit(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Split / itemize (e.g. cost + VAT)
        </label>
        {split && (
          <button
            type="button"
            onClick={autoVatSplit}
            disabled={!canAutoVat}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40 hover:bg-slate-50"
            title={
              canAutoVat
                ? `Split into cost + VAT Input at ${effectiveVatRate}% — leave the cost line's category blank to set it later`
                : 'No VAT rate available — set the company VAT rate (or pick a VAT-registered vendor) and ensure a VAT Input account exists'
            }
          >
            Auto-VAT split
          </button>
        )}
      </div>

      {/* Split grid */}
      {split && (
        <div className="rounded-md border border-slate-200 p-2 space-y-2">
          {lines.map((l, i) => (
            <div
              key={i}
              className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center"
            >
              <div className="md:col-span-4">
                <AccountingAccountPicker
                  value={l.accountingAccountId}
                  onChange={(id) => setLine(i, { accountingAccountId: id })}
                  accounts={props.categories}
                  placeholder="— category —"
                />
              </div>
              <div className="md:col-span-2">
                <ProjectPicker
                  value={l.projectId ?? ''}
                  projects={props.projects.map((o) => ({
                    id: o.id,
                    name: o.label,
                  }))}
                  customers={props.customers}
                  noneLabel="— no project —"
                  onChange={(id) => setLine(i, { projectId: id })}
                />
              </div>
              <div className="md:col-span-3">
                <Input
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                  placeholder="Description"
                  className="h-9 text-xs"
                />
              </div>
              <div className="md:col-span-2">
                <Input
                  type="number"
                  step="0.01"
                  value={l.amount}
                  onChange={(e) => setLine(i, { amount: e.target.value })}
                  placeholder="0.00"
                  className="h-9 text-xs text-right tabular-nums"
                />
              </div>
              <div className="md:col-span-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  className="text-slate-400 hover:text-red-600 text-lg leading-none"
                  title="Remove line"
                  aria-label="Remove line"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={addLine}
              className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
            >
              + Add line
            </button>
            <div className="text-xs tabular-nums">
              <span className="text-slate-500">Lines </span>
              <span className="font-medium">{money(linesTotal, props.currency)}</span>
              <span className="text-slate-400">
                {' '}
                / {money(props.grossAmount, props.currency)}
              </span>
              {balanced ? (
                <span className="ml-2 text-emerald-700">balanced ✓</span>
              ) : (
                <span className="ml-2 text-amber-700">
                  {remaining > 0
                    ? `${money(remaining, props.currency)} unallocated`
                    : `${money(-remaining, props.currency)} over`}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Inline manual-entry editor — date / description / direction / amount */}
      {editingEntry && props.manualInitial && (
        <div className="rounded-md border border-slate-300 bg-slate-50 p-3 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Edit manual entry
          </p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-12">
            <div className="md:col-span-2">
              <FieldLabel>Date</FieldLabel>
              <Input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div className="col-span-2 md:col-span-5">
              <FieldLabel>Description</FieldLabel>
              <Input
                value={entryDesc}
                onChange={(e) => setEntryDesc(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div className="md:col-span-2">
              <FieldLabel>Direction</FieldLabel>
              <select
                value={entryDirection}
                onChange={(e) =>
                  setEntryDirection(e.target.value === 'in' ? 'in' : 'out')
                }
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
              >
                <option value="out">Money out</option>
                <option value="in">Money in</option>
              </select>
            </div>
            <div className="md:col-span-3">
              <FieldLabel>Amount</FieldLabel>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={entryAmount}
                onChange={(e) => setEntryAmount(e.target.value)}
                className="h-9 text-xs text-right tabular-nums"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={savingEntry}
              onClick={saveEntry}
            >
              {savingEntry ? '…' : 'Save entry'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditingEntry(false)}
            >
              Cancel
            </Button>
            {entryError && (
              <p className="text-xs text-red-600">{entryError}</p>
            )}
          </div>
        </div>
      )}

      {/* Flags + Save + Notes */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
        <div className="md:col-span-9 flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              name="isReviewed"
              checked={isReviewed}
              onChange={(e) => setIsReviewed(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Reviewed
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              name="isIgnored"
              checked={isIgnored}
              onChange={(e) => setIsIgnored(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Ignore
          </label>
        </div>
        <div className="md:col-span-3 flex items-center gap-2 md:justify-end">
          {props.isManualEntry && props.canEdit && props.manualInitial && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || deleting || savingEntry}
              onClick={() => setEditingEntry((v) => !v)}
              title="Fix this manually added entry's date / description / amount"
            >
              {editingEntry ? 'Close editor' : 'Edit entry'}
            </Button>
          )}
          {props.isManualEntry && props.canEdit && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-red-300 text-red-700 hover:bg-red-50"
              disabled={pending || deleting}
              onClick={deleteEntry}
              title="Delete this manually added transaction"
            >
              {deleting ? '…' : 'Delete entry'}
            </Button>
          )}
          <Button type="submit" size="sm" disabled={pending || (split && !balanced)}>
            {pending ? '…' : 'Save'}
          </Button>
        </div>
        <div className="md:col-span-12">
          <Input
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="h-9 text-xs"
          />
        </div>
      </div>

      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
      {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
    </form>
  );
}
