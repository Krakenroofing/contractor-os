'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  VendorPicker,
  type VendorPickerOption,
} from '@/modules/vendors/components/vendor-picker';
import { ProjectPicker } from '@/modules/projects/components/project-picker';
import type { CustomerPickerOption } from '@/modules/customers/components/customer-picker';
import { BankAccountPicker } from '@/modules/banking/components/bank-account-picker';
import {
  upsertReceiptAction,
  type ReceiptActionState,
} from '../actions';
import { saveVendorDefaultsAction } from '@/modules/vendors/actions';
import {
  COST_TYPE_LABEL,
  PAYMENT_SOURCE_LABEL,
  costTypeValues,
  paymentSourceValues,
} from '../schema';
import { computeVat } from '../lib/vat';
import {
  AccountingAccountPicker,
  type AccountingAccountOption,
} from '@/modules/accounting/components/accounting-account-picker';

type Option = { id: string; label: string };

// Vendor option carries the three default fields so the form can prefill on
// vendor change without an extra round-trip. Empty string == no default set.
export type VendorOption = {
  id: string;
  label: string;
  defaultCostCodeId: string;
  defaultCostType: string;
  defaultAccountingAccountId: string;
};

export type LineInitial = {
  id?: string;
  projectId: string | null;
  costCodeId: string | null;
  accountingAccountId: string | null;
  costType: string | null;
  description: string | null;
  subtotal: number;
  vatAmount: number;
  total: number;
  vatRatePercent: number | null;
  isBillable: boolean;
  isReimbursable: boolean;
  paidByUserId: string | null;
  reimbursementPayoutId: string | null;
};

export type ReceiptFormProps = {
  initial?: {
    id?: string;
    receiptDate: string;
    vendorId: string | null;
    bankAccountId: string | null;
    paymentSourceType: 'bank' | 'credit_card' | 'cash' | 'other';
    currency: string;
    vatRatePercent: number | null;
    vatIncluded: boolean;
    vatRecoverable: boolean;
    vendorTin: string | null;
    notes: string | null;
  };
  initialLines?: LineInitial[];
  vatActive: boolean;
  defaultCurrency: string;
  defaultVatRate: number;
  /** Logged-in user — default payer when a new line is marked reimbursable. */
  currentUserId?: string;
  vendors: VendorOption[];
  projects: Option[];
  customers: CustomerPickerOption[];
  costCodes: Option[];
  accountingAccounts: AccountingAccountOption[];
  bankAccounts: Option[];
  /** Members of the active company, for the "Paid by" dropdown. */
  members: Array<{ id: string; label: string }>;
};

type LineState = {
  // Stable client-side key for React. Either the persisted line id or a
  // synthetic uuid-ish string for not-yet-saved lines.
  key: string;
  id?: string;
  projectId: string;
  costCodeId: string;
  accountingAccountId: string;
  costType: string;
  description: string;
  subtotal: string;
  vatAmount: string;
  total: string;
  vatRatePercent: string;
  isBillable: boolean;
  isReimbursable: boolean;
  paidByUserId: string;
  /** Non-empty = this line was already settled by a payout; UI locks money +
   *  reimbursable flag + paid-by. */
  reimbursementPayoutId: string;
};

let synthCounter = 0;
function synthKey(): string {
  synthCounter += 1;
  return `new-${Date.now().toString(36)}-${synthCounter}`;
}

function emptyLine(): LineState {
  return {
    key: synthKey(),
    projectId: '',
    costCodeId: '',
    accountingAccountId: '',
    costType: '',
    description: '',
    subtotal: '0.00',
    vatAmount: '0.00',
    total: '0.00',
    vatRatePercent: '',
    isBillable: false,
    isReimbursable: false,
    paidByUserId: '',
    reimbursementPayoutId: '',
  };
}

function initialToState(line: LineInitial): LineState {
  return {
    key: line.id ?? synthKey(),
    id: line.id,
    projectId: line.projectId ?? '',
    costCodeId: line.costCodeId ?? '',
    accountingAccountId: line.accountingAccountId ?? '',
    costType: line.costType ?? '',
    description: line.description ?? '',
    subtotal: line.subtotal.toFixed(2),
    vatAmount: line.vatAmount.toFixed(2),
    total: line.total.toFixed(2),
    vatRatePercent:
      line.vatRatePercent === null ? '' : line.vatRatePercent.toString(),
    isBillable: line.isBillable,
    isReimbursable: line.isReimbursable,
    paidByUserId: line.paidByUserId ?? '',
    reimbursementPayoutId: line.reimbursementPayoutId ?? '',
  };
}

export function ReceiptForm(props: ReceiptFormProps) {
  const i = props.initial;
  const [receiptDate, setReceiptDate] = useState(
    i?.receiptDate ?? new Date().toISOString().slice(0, 10),
  );
  const [vendorId, setVendorId] = useState(i?.vendorId ?? '');
  const [bankAccountId, setBankAccountId] = useState(i?.bankAccountId ?? '');
  const [paymentSourceType, setPaymentSourceType] = useState(
    i?.paymentSourceType ?? 'cash',
  );
  const [currency, setCurrency] = useState(i?.currency ?? props.defaultCurrency);
  const [vatRatePercent, setVatRatePercent] = useState(
    (i?.vatRatePercent ?? props.defaultVatRate).toString(),
  );
  const [vatIncluded, setVatIncluded] = useState(i?.vatIncluded ?? true);
  const [vatRecoverable, setVatRecoverable] = useState(i?.vatRecoverable ?? true);
  const [vendorTin, setVendorTin] = useState(i?.vendorTin ?? '');
  const [notes, setNotes] = useState(i?.notes ?? '');

  const [lines, setLines] = useState<LineState[]>(() =>
    props.initialLines && props.initialLines.length > 0
      ? props.initialLines.map(initialToState)
      : [emptyLine()],
  );

  function updateLine(key: string, patch: Partial<LineState>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }

  function recomputeLine(
    key: string,
    driver: 'subtotal' | 'vatAmount' | 'total' | 'rate',
  ) {
    if (!props.vatActive) return;
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const effectiveRate =
          Number(l.vatRatePercent) || Number(vatRatePercent) || 0;
        const out = computeVat({
          subtotal: Number(l.subtotal) || 0,
          vatAmount: Number(l.vatAmount) || 0,
          total: Number(l.total) || 0,
          vatRatePercent: effectiveRate,
          vatIncluded,
          driver,
        });
        return {
          ...l,
          subtotal: out.subtotal.toFixed(2),
          vatAmount: out.vatAmount.toFixed(2),
          total: out.total.toFixed(2),
        };
      }),
    );
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  // Live header totals — what the operator sees while editing. Server
  // recomputes from line money on submit; these are display-only.
  const headerTotals = useMemo(() => {
    let s = 0, v = 0, t = 0;
    for (const l of lines) {
      s += Number(l.subtotal) || 0;
      v += Number(l.vatAmount) || 0;
      t += Number(l.total) || 0;
    }
    const r = (n: number) => Math.round(n * 100) / 100;
    return { subtotal: r(s), vat: r(v), total: r(t) };
  }, [lines]);

  const [state, action, pending] = useActionState<ReceiptActionState, FormData>(
    upsertReceiptAction,
    {},
  );

  const router = useRouter();
  const [savingDefaults, startSavingDefaults] = useTransition();
  const [savedDefaultsAt, setSavedDefaultsAt] = useState<number | null>(null);

  // Prefill blanks on FIRST line from a vendor's defaults. Never overwrites
  // values the operator already picked (Phase-1 contract).
  function applyVendorDefaults(v: {
    defaultCostCodeId?: string | null;
    defaultCostType?: string | null;
    defaultAccountingAccountId?: string | null;
  }) {
    const first = lines[0];
    if (!first) return;
    const patch: Partial<LineState> = {};
    if (!first.costCodeId && v.defaultCostCodeId)
      patch.costCodeId = v.defaultCostCodeId;
    if (!first.costType && v.defaultCostType)
      patch.costType = v.defaultCostType;
    if (!first.accountingAccountId && v.defaultAccountingAccountId)
      patch.accountingAccountId = v.defaultAccountingAccountId;
    if (Object.keys(patch).length > 0) updateLine(first.key, patch);
  }

  function onVendorChange(id: string, v?: VendorPickerOption) {
    setVendorId(id);
    if (v) applyVendorDefaults(v);
  }

  // "Save as default" — uses the FIRST line's values (the common Home Depot
  // / Sherwin-Williams pattern: one vendor, one line).
  const firstLine = lines[0];
  const selectedVendor = props.vendors.find((x) => x.id === vendorId) ?? null;
  const defaultsDiffer = Boolean(
    selectedVendor &&
      firstLine &&
      (selectedVendor.defaultCostCodeId !== firstLine.costCodeId ||
        selectedVendor.defaultCostType !== firstLine.costType ||
        selectedVendor.defaultAccountingAccountId !==
          firstLine.accountingAccountId) &&
      (firstLine.costCodeId !== '' ||
        firstLine.costType !== '' ||
        firstLine.accountingAccountId !== ''),
  );

  function onSaveDefaults() {
    if (!vendorId || !firstLine) return;
    startSavingDefaults(async () => {
      const res = await saveVendorDefaultsAction({
        vendorId,
        defaultCostCodeId: firstLine.costCodeId || null,
        defaultCostType: firstLine.costType || null,
        defaultAccountingAccountId: firstLine.accountingAccountId || null,
      });
      if (res.ok) {
        setSavedDefaultsAt(Date.now());
        router.refresh();
      } else if (res.error) {
        alert(res.error);
      }
    });
  }

  // Serialize the lines array into a hidden JSON field on submit. We could
  // use indexed form fields, but a single JSON blob keeps the action's
  // parsing trivial.
  const linesJson = useMemo(
    () =>
      JSON.stringify(
        lines.map((l, idx) => ({
          id: l.id,
          sortOrder: idx,
          projectId: l.projectId || null,
          costCodeId: l.costCodeId || null,
          accountingAccountId: l.accountingAccountId || null,
          costType: l.costType || null,
          description: l.description || null,
          subtotal: l.subtotal || '0',
          vatAmount: l.vatAmount || '0',
          total: l.total || '0',
          vatRatePercent: l.vatRatePercent === '' ? null : l.vatRatePercent,
          isBillable: l.isBillable,
          isReimbursable: l.isReimbursable,
          paidByUserId: l.paidByUserId || null,
        })),
      ),
    [lines],
  );

  return (
    <form action={action} className="space-y-6">
      {i?.id && <input type="hidden" name="id" value={i.id} />}
      <input type="hidden" name="lines" value={linesJson} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="receiptDate">Receipt date</Label>
          <Input
            id="receiptDate"
            name="receiptDate"
            type="date"
            value={receiptDate}
            onChange={(e) => setReceiptDate(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="vendorId">Vendor (optional)</Label>
          <VendorPicker
            id="vendorId"
            name="vendorId"
            value={vendorId}
            vendors={props.vendors.map((v) => ({
              id: v.id,
              name: v.label,
              defaultCostCodeId: v.defaultCostCodeId || null,
              defaultCostType: v.defaultCostType || null,
              defaultAccountingAccountId: v.defaultAccountingAccountId || null,
            }))}
            onChange={onVendorChange}
            noneLabel="—"
          />
          {defaultsDiffer && (
            <button
              type="button"
              onClick={onSaveDefaults}
              disabled={savingDefaults}
              className="mt-1 text-[11px] text-slate-600 underline hover:text-slate-900 disabled:opacity-60"
            >
              {savingDefaults
                ? 'Saving…'
                : `Save line 1's cost code / type / category as default for ${selectedVendor?.label}`}
            </button>
          )}
          {savedDefaultsAt !== null && !defaultsDiffer && !savingDefaults && (
            <p className="mt-1 text-[11px] text-emerald-700">
              Saved as default.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            required
          />
        </div>
      </div>

      <div className="rounded-md border border-slate-200 p-4 space-y-3">
        <h3 className="text-sm font-medium text-slate-900">Payment</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="paymentSourceType">Paid via</Label>
            <Select
              id="paymentSourceType"
              name="paymentSourceType"
              value={paymentSourceType}
              onChange={(e) =>
                setPaymentSourceType(
                  e.target.value as 'bank' | 'credit_card' | 'cash' | 'other',
                )
              }
            >
              {paymentSourceValues.map((p) => (
                <option key={p} value={p}>
                  {PAYMENT_SOURCE_LABEL[p]}
                </option>
              ))}
            </Select>
          </div>
          {(paymentSourceType === 'bank' || paymentSourceType === 'credit_card') && (
            <div>
              <Label htmlFor="bankAccountId">Bank / card account</Label>
              <BankAccountPicker
                id="bankAccountId"
                name="bankAccountId"
                value={bankAccountId}
                accounts={props.bankAccounts}
                noneLabel="— none —"
                onChange={(id) => setBankAccountId(id)}
              />
            </div>
          )}
        </div>
      </div>

      {props.vatActive && (
        <div className="rounded-md border border-slate-200 p-4 space-y-3">
          <h3 className="text-sm font-medium text-slate-900">VAT (header defaults)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label htmlFor="vatRatePercent">Default VAT rate %</Label>
              <Input
                id="vatRatePercent"
                name="vatRatePercent"
                inputMode="decimal"
                value={vatRatePercent}
                onChange={(e) => setVatRatePercent(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  name="vatIncluded"
                  checked={vatIncluded}
                  onChange={(e) => setVatIncluded(e.target.checked)}
                  className="h-4 w-4"
                />
                Totals include VAT
              </label>
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  name="vatRecoverable"
                  checked={vatRecoverable}
                  onChange={(e) => setVatRecoverable(e.target.checked)}
                  className="h-4 w-4"
                />
                VAT recoverable
              </label>
            </div>
            <div>
              <Label htmlFor="vendorTin">Vendor TIN (optional)</Label>
              <Input
                id="vendorTin"
                name="vendorTin"
                value={vendorTin}
                onChange={(e) => setVendorTin(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Each line inherits this rate unless overridden. Edit net / VAT /
            gross per line below — the other two recompute on blur.
          </p>
        </div>
      )}
      {!props.vatActive && (
        <>
          <input type="hidden" name="vatRatePercent" value="0" />
          <input type="hidden" name="vatIncluded" value="false" />
          <input type="hidden" name="vatRecoverable" value="false" />
        </>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-900">
            Lines ({lines.length})
          </h3>
          <Button type="button" onClick={addLine} variant="outline" size="sm">
            + Add line
          </Button>
        </div>
        {lines.map((l, idx) => (
          <LineEditor
            key={l.key}
            line={l}
            index={idx}
            canRemove={lines.length > 1 && !l.reimbursementPayoutId}
            vatActive={props.vatActive}
            projects={props.projects}
            customers={props.customers}
            costCodes={props.costCodes}
            accountingAccounts={props.accountingAccounts}
            members={props.members}
            currentUserId={props.currentUserId}
            onChange={(patch) => updateLine(l.key, patch)}
            onRemove={() => removeLine(l.key)}
            onRecompute={(driver) => recomputeLine(l.key, driver)}
          />
        ))}
        <div className="flex justify-end gap-6 text-xs text-slate-600 pr-2">
          <div>
            Subtotal:{' '}
            <span className="font-mono tabular-nums">
              {headerTotals.subtotal.toFixed(2)}
            </span>
          </div>
          {props.vatActive && (
            <div>
              VAT:{' '}
              <span className="font-mono tabular-nums">
                {headerTotals.vat.toFixed(2)}
              </span>
            </div>
          )}
          <div className="font-medium text-slate-900">
            Total:{' '}
            <span className="font-mono tabular-nums">
              {headerTotals.total.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div>
        <Label htmlFor="notes">Notes (optional)</Label>
        <Input
          id="notes"
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What was bought, who paid, project context"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : i?.id ? 'Save draft' : 'Create receipt'}
        </Button>
        {state.formError && (
          <p className="text-xs text-red-600">{state.formError}</p>
        )}
      </div>
    </form>
  );
}

function LineEditor(props: {
  line: LineState;
  index: number;
  canRemove: boolean;
  vatActive: boolean;
  projects: Option[];
  customers: CustomerPickerOption[];
  costCodes: Option[];
  accountingAccounts: AccountingAccountOption[];
  members: Array<{ id: string; label: string }>;
  currentUserId?: string;
  onChange: (patch: Partial<LineState>) => void;
  onRemove: () => void;
  onRecompute: (driver: 'subtotal' | 'vatAmount' | 'total' | 'rate') => void;
}) {
  const { line: l } = props;
  const locked = Boolean(l.reimbursementPayoutId);
  function onReimbursableToggle(checked: boolean) {
    // Auto-default the payer to the current user the first time the operator
    // checks the box, to save a click in the common "I bought this" case.
    const patch: Partial<LineState> = { isReimbursable: checked };
    if (checked && !l.paidByUserId && props.currentUserId) {
      patch.paidByUserId = props.currentUserId;
    }
    if (!checked) patch.paidByUserId = '';
    props.onChange(patch);
  }
  return (
    <div className="rounded-md border border-slate-200 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">
          Line {props.index + 1}
          {locked && (
            <span className="ml-2 inline-block rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px]">
              Reimbursed (locked)
            </span>
          )}
        </span>
        {props.canRemove && (
          <button
            type="button"
            onClick={props.onRemove}
            className="text-[11px] text-red-600 hover:text-red-800"
          >
            Remove
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label>Project</Label>
          <ProjectPicker
            value={l.projectId}
            projects={props.projects.map((p) => ({ id: p.id, name: p.label }))}
            customers={props.customers}
            onChange={(id) => props.onChange({ projectId: id })}
            noneLabel="— none —"
          />
        </div>
        <div>
          <Label>Cost code</Label>
          <Select
            value={l.costCodeId}
            onChange={(e) => props.onChange({ costCodeId: e.target.value })}
          >
            <option value="">— none —</option>
            {props.costCodes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Accounting category</Label>
          <AccountingAccountPicker
            value={l.accountingAccountId}
            onChange={(id) => props.onChange({ accountingAccountId: id })}
            accounts={props.accountingAccounts}
            placeholder="— none —"
          />
        </div>
        <div>
          <Label>Cost type</Label>
          <Select
            value={l.costType}
            onChange={(e) => props.onChange({ costType: e.target.value })}
          >
            <option value="">— derive from cost code —</option>
            {costTypeValues.map((c) => (
              <option key={c} value={c}>
                {COST_TYPE_LABEL[c]}
              </option>
            ))}
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label>Description (optional)</Label>
          <Input
            value={l.description}
            onChange={(e) => props.onChange({ description: e.target.value })}
            placeholder="What this line is for"
          />
        </div>
      </div>

      {props.vatActive ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label>Net</Label>
            <Input
              inputMode="decimal"
              value={l.subtotal}
              onChange={(e) => props.onChange({ subtotal: e.target.value })}
              onBlur={() => props.onRecompute('subtotal')}
            />
          </div>
          <div>
            <Label>VAT</Label>
            <Input
              inputMode="decimal"
              value={l.vatAmount}
              onChange={(e) => props.onChange({ vatAmount: e.target.value })}
              onBlur={() => props.onRecompute('vatAmount')}
            />
          </div>
          <div>
            <Label>Gross</Label>
            <Input
              inputMode="decimal"
              value={l.total}
              onChange={(e) => props.onChange({ total: e.target.value })}
              onBlur={() => props.onRecompute('total')}
            />
          </div>
          <div>
            <Label>Rate % (override)</Label>
            <Input
              inputMode="decimal"
              value={l.vatRatePercent}
              onChange={(e) => props.onChange({ vatRatePercent: e.target.value })}
              onBlur={() => props.onRecompute('rate')}
              placeholder="header"
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Total</Label>
            <Input
              inputMode="decimal"
              value={l.total}
              onChange={(e) =>
                props.onChange({
                  total: e.target.value,
                  subtotal: e.target.value,
                })
              }
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={l.isBillable}
            onChange={(e) => props.onChange({ isBillable: e.target.checked })}
            className="h-4 w-4"
          />
          Billable to customer
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={l.isReimbursable}
            disabled={locked}
            onChange={(e) => onReimbursableToggle(e.target.checked)}
            className="h-4 w-4"
          />
          Reimbursable to staff
        </label>
      </div>
      {l.isReimbursable && (
        <div>
          <Label>Paid by (out of pocket)</Label>
          <Select
            value={l.paidByUserId}
            disabled={locked}
            onChange={(e) => props.onChange({ paidByUserId: e.target.value })}
          >
            <option value="">— pick a person —</option>
            {props.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11px] text-slate-500">
            Reimbursement is owed for the gross (
            <span className="font-mono">{l.total}</span>) — the worker was out
            of pocket the full amount.
          </p>
        </div>
      )}
    </div>
  );
}
