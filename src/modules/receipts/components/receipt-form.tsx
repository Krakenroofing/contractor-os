'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
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

export type ReceiptFormProps = {
  initial?: {
    id?: string;
    receiptDate: string;
    vendorId: string | null;
    projectId: string | null;
    costCodeId: string | null;
    accountingAccountId: string | null;
    bankAccountId: string | null;
    paymentSourceType: 'bank' | 'credit_card' | 'cash' | 'other';
    currency: string;
    subtotal: number;
    vatAmount: number;
    total: number;
    vatRatePercent: number | null;
    vatIncluded: boolean;
    vatRecoverable: boolean;
    vendorTin: string | null;
    costType: string | null;
    isBillable: boolean;
    isReimbursable: boolean;
    notes: string | null;
  };
  vatActive: boolean;
  defaultCurrency: string;
  defaultVatRate: number;
  vendors: VendorOption[];
  projects: Option[];
  costCodes: Option[];
  accountingAccounts: Option[];
  bankAccounts: Option[];
};

export function ReceiptForm(props: ReceiptFormProps) {
  const i = props.initial;
  const [receiptDate, setReceiptDate] = useState(
    i?.receiptDate ?? new Date().toISOString().slice(0, 10),
  );
  const [vendorId, setVendorId] = useState(i?.vendorId ?? '');
  const [projectId, setProjectId] = useState(i?.projectId ?? '');
  const [costCodeId, setCostCodeId] = useState(i?.costCodeId ?? '');
  const [accountingAccountId, setAccountingAccountId] = useState(
    i?.accountingAccountId ?? '',
  );
  const [bankAccountId, setBankAccountId] = useState(i?.bankAccountId ?? '');
  const [paymentSourceType, setPaymentSourceType] = useState(
    i?.paymentSourceType ?? 'cash',
  );
  const [currency, setCurrency] = useState(i?.currency ?? props.defaultCurrency);
  const [subtotal, setSubtotal] = useState(i?.subtotal?.toFixed(2) ?? '0.00');
  const [vatAmount, setVatAmount] = useState(i?.vatAmount?.toFixed(2) ?? '0.00');
  const [total, setTotal] = useState(i?.total?.toFixed(2) ?? '0.00');
  const [vatRatePercent, setVatRatePercent] = useState(
    (i?.vatRatePercent ?? props.defaultVatRate).toString(),
  );
  const [vatIncluded, setVatIncluded] = useState(i?.vatIncluded ?? true);
  const [vatRecoverable, setVatRecoverable] = useState(i?.vatRecoverable ?? true);
  const [vendorTin, setVendorTin] = useState(i?.vendorTin ?? '');
  const [costType, setCostType] = useState(i?.costType ?? '');
  const [isBillable, setIsBillable] = useState(i?.isBillable ?? false);
  const [isReimbursable, setIsReimbursable] = useState(i?.isReimbursable ?? false);
  const [notes, setNotes] = useState(i?.notes ?? '');

  function recompute(driver: 'subtotal' | 'vatAmount' | 'total' | 'rate') {
    if (!props.vatActive) return;
    const out = computeVat({
      subtotal: Number(subtotal) || 0,
      vatAmount: Number(vatAmount) || 0,
      total: Number(total) || 0,
      vatRatePercent: Number(vatRatePercent) || 0,
      vatIncluded,
      driver,
    });
    setSubtotal(out.subtotal.toFixed(2));
    setVatAmount(out.vatAmount.toFixed(2));
    setTotal(out.total.toFixed(2));
  }

  const [state, action, pending] = useActionState<ReceiptActionState, FormData>(
    upsertReceiptAction,
    {},
  );

  const router = useRouter();
  const [savingDefaults, startSavingDefaults] = useTransition();
  const [savedDefaultsAt, setSavedDefaultsAt] = useState<number | null>(null);

  // Prefill blanks from a vendor's defaults. Never overwrites a value the
  // operator already picked — that's the Phase-1 contract. Called when the
  // vendor select changes.
  function applyVendorDefaults(v: VendorOption) {
    if (!costCodeId && v.defaultCostCodeId) setCostCodeId(v.defaultCostCodeId);
    if (!costType && v.defaultCostType) setCostType(v.defaultCostType);
    if (!accountingAccountId && v.defaultAccountingAccountId) {
      setAccountingAccountId(v.defaultAccountingAccountId);
    }
  }

  function onVendorChange(id: string) {
    setVendorId(id);
    const v = props.vendors.find((x) => x.id === id);
    if (v) applyVendorDefaults(v);
  }

  // Compute whether the currently-picked vendor's defaults differ from what's
  // in the form right now. Drives visibility of the inline "Save as default"
  // affordance. If no vendor is selected → never show.
  const selectedVendor = props.vendors.find((x) => x.id === vendorId) ?? null;
  const defaultsDiffer = Boolean(
    selectedVendor &&
      (selectedVendor.defaultCostCodeId !== (costCodeId ?? '') ||
        selectedVendor.defaultCostType !== (costType ?? '') ||
        selectedVendor.defaultAccountingAccountId !==
          (accountingAccountId ?? '')) &&
      // Only offer to save when at least one of the three fields is set —
      // otherwise the user is just clearing defaults, which they should do
      // from the vendor edit page.
      (costCodeId !== '' ||
        costType !== '' ||
        accountingAccountId !== ''),
  );

  function onSaveDefaults() {
    if (!vendorId) return;
    startSavingDefaults(async () => {
      const res = await saveVendorDefaultsAction({
        vendorId,
        defaultCostCodeId: costCodeId || null,
        defaultCostType: costType || null,
        defaultAccountingAccountId: accountingAccountId || null,
      });
      if (res.ok) {
        setSavedDefaultsAt(Date.now());
        router.refresh();
      } else if (res.error) {
        alert(res.error);
      }
    });
  }

  return (
    <form action={action} className="space-y-6">
      {i?.id && <input type="hidden" name="id" value={i.id} />}

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
          <Select
            id="vendorId"
            name="vendorId"
            value={vendorId}
            onChange={(e) => onVendorChange(e.target.value)}
          >
            <option value="">—</option>
            {props.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
          {defaultsDiffer && (
            <button
              type="button"
              onClick={onSaveDefaults}
              disabled={savingDefaults}
              className="mt-1 text-[11px] text-slate-600 underline hover:text-slate-900 disabled:opacity-60"
            >
              {savingDefaults
                ? 'Saving…'
                : `Save current cost code / type / category as default for ${selectedVendor?.label}`}
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
        <h3 className="text-sm font-medium text-slate-900">Assign</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="projectId">Project (required to post)</Label>
            <Select
              id="projectId"
              name="projectId"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">— none —</option>
              {props.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="costCodeId">Cost code (required to post)</Label>
            <Select
              id="costCodeId"
              name="costCodeId"
              value={costCodeId}
              onChange={(e) => setCostCodeId(e.target.value)}
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
            <Label htmlFor="accountingAccountId">Accounting category</Label>
            <Select
              id="accountingAccountId"
              name="accountingAccountId"
              value={accountingAccountId}
              onChange={(e) => setAccountingAccountId(e.target.value)}
            >
              <option value="">— none —</option>
              {props.accountingAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="costType">Cost type (job costing)</Label>
            <Select
              id="costType"
              name="costType"
              value={costType}
              onChange={(e) => setCostType(e.target.value)}
            >
              <option value="">— derive from cost code —</option>
              {costTypeValues.map((c) => (
                <option key={c} value={c}>
                  {COST_TYPE_LABEL[c]}
                </option>
              ))}
            </Select>
          </div>
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
              <Select
                id="bankAccountId"
                name="bankAccountId"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">— none —</option>
                {props.bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-md border border-slate-200 p-4 space-y-3">
        <h3 className="text-sm font-medium text-slate-900">Amounts</h3>
        {props.vatActive ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label htmlFor="vatRatePercent">VAT rate %</Label>
                <Input
                  id="vatRatePercent"
                  name="vatRatePercent"
                  inputMode="decimal"
                  value={vatRatePercent}
                  onChange={(e) => setVatRatePercent(e.target.value)}
                  onBlur={() => recompute('rate')}
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
                  Total includes VAT
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
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="subtotal">Subtotal (net)</Label>
                <Input
                  id="subtotal"
                  name="subtotal"
                  inputMode="decimal"
                  value={subtotal}
                  onChange={(e) => setSubtotal(e.target.value)}
                  onBlur={() => recompute('subtotal')}
                />
              </div>
              <div>
                <Label htmlFor="vatAmount">VAT amount</Label>
                <Input
                  id="vatAmount"
                  name="vatAmount"
                  inputMode="decimal"
                  value={vatAmount}
                  onChange={(e) => setVatAmount(e.target.value)}
                  onBlur={() => recompute('vatAmount')}
                />
              </div>
              <div>
                <Label htmlFor="total">Total (gross)</Label>
                <Input
                  id="total"
                  name="total"
                  inputMode="decimal"
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                  onBlur={() => recompute('total')}
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Edit any one of net / VAT / gross — the other two recompute on
              blur using {vatIncluded ? 'gross ÷ (1 + rate%)' : 'net × (1 + rate%)'}.
            </p>
          </>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="total">Total</Label>
              <Input
                id="total"
                name="total"
                inputMode="decimal"
                value={total}
                onChange={(e) => {
                  setTotal(e.target.value);
                  setSubtotal(e.target.value);
                }}
              />
            </div>
            <p className="text-xs text-slate-500 self-end pb-2">
              VAT is off for this company. Subtotal equals total.
            </p>
            {/* Hidden fields so server schema is happy. */}
            <input type="hidden" name="subtotal" value={total} />
            <input type="hidden" name="vatAmount" value="0" />
            <input type="hidden" name="vatRatePercent" value="0" />
            <input type="hidden" name="vatIncluded" value="false" />
            <input type="hidden" name="vatRecoverable" value="false" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isBillable"
            checked={isBillable}
            onChange={(e) => setIsBillable(e.target.checked)}
            className="h-4 w-4"
          />
          Billable to customer
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isReimbursable"
            checked={isReimbursable}
            onChange={(e) => setIsReimbursable(e.target.checked)}
            className="h-4 w-4"
          />
          Reimbursable to staff
        </label>
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
