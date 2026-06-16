'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  updateImportedTransactionAction,
  type BankingActionState,
} from '../actions';
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
  vatInputAccountId: string | null;
  canEdit: boolean;
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
  const canAutoVat = Boolean(
    selectedVendor?.vatRatePercent && props.vatInputAccountId,
  );

  // Fill the grid with the cost + VAT Input split derived from the vendor's
  // rate. Cost line uses the current category (or the vendor default); VAT
  // line goes to the resolved VAT Input account.
  function autoVatSplit() {
    const rate = selectedVendor?.vatRatePercent ?? 0;
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
              <Select
                name="projectId"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">— no project —</option>
                {props.projects.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
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
                ? "Fill cost + VAT Input lines from the vendor's VAT rate"
                : 'Pick a VAT-registered vendor first (and ensure a VAT Input account exists)'
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
                <Select
                  value={l.projectId}
                  onChange={(e) => setLine(i, { projectId: e.target.value })}
                >
                  <option value="">— no project —</option>
                  {props.projects.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
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
                  min="0"
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
        <div className="md:col-span-3 flex items-center md:justify-end">
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
    </form>
  );
}
