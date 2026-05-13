'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { add, formatMoney, multiply, subtract } from '@/lib/money';
import { createInvoiceAction, type CreateInvoiceState } from '../actions';
import {
  BILLING_TYPE_LABEL,
  STATUS_LABEL,
  billingTypeValues,
  invoiceStatusValues,
} from '../schema';

const initialState: CreateInvoiceState = {};

type LineDraft = {
  rowId: string;
  description: string;
  unit: string;
  quantity: string;
  unitCost: string;
};

function newEmptyLine(): LineDraft {
  return {
    rowId: crypto.randomUUID(),
    description: '',
    unit: '',
    quantity: '1',
    unitCost: '0',
  };
}

export type InvoiceFormProjectOption = { id: string; label: string };
export type InvoiceFormProposalOption = { id: string; label: string; projectId: string };
export type InvoiceFormChangeOrderOption = {
  id: string;
  label: string;
  projectId: string;
};
export type InvoiceFormTemplateOption = { id: string; name: string };

export function InvoiceForm({
  projects,
  proposals,
  changeOrders,
  templates,
  defaultNumber,
  defaultInvoiceDate,
  defaultDueDate,
  companyVatRatePercent = 0,
}: {
  projects: InvoiceFormProjectOption[];
  proposals: InvoiceFormProposalOption[];
  changeOrders: InvoiceFormChangeOrderOption[];
  templates: InvoiceFormTemplateOption[];
  defaultNumber: string;
  defaultInvoiceDate: string;
  defaultDueDate: string;
  /**
   * The active company's VAT rate (numeric percent). When > 0, the Tax/VAT
   * field auto-fills to subtotal × rate / 100 as the user edits line items.
   * Manual override still works — once the user types in the field, we stop
   * auto-syncing for the rest of the session.
   */
  companyVatRatePercent?: number;
}) {
  const [state, formAction, pending] = useActionState(createInvoiceAction, initialState);
  const [lines, setLines] = useState<LineDraft[]>([newEmptyLine()]);
  const [projectId, setProjectId] = useState('');
  const [billingType, setBillingType] = useState<string>('progress');
  // Lump-sum mode bypasses the qty × unit-cost editor and ships a single
  // line with the entered amount as unitCost (qty=1). Detailed line items
  // would be overkill for contract draws.
  const [lumpDescription, setLumpDescription] = useState('');
  const [lumpAmount, setLumpAmount] = useState('0');
  const [percentOfContract, setPercentOfContract] = useState('');
  const [taxAmount, setTaxAmount] = useState('0');
  // Stops auto-VAT-sync once the user has typed in the Tax field — they
  // get full manual control on edit but the field pre-fills for fresh
  // invoices when the company has a VAT rate set.
  const [taxAmountManual, setTaxAmountManual] = useState(false);
  const [retainagePercent, setRetainagePercent] = useState('0');
  const [retainageAmount, setRetainageAmount] = useState('0');
  const [retainageAmountManual, setRetainageAmountManual] = useState(false);
  const [expectedRetainageReleaseDate, setExpectedRetainageReleaseDate] = useState('');
  const [amountPaid, setAmountPaid] = useState('0');
  const isLumpSum = billingType === 'lump_sum';

  const filteredProposals = useMemo(
    () => (projectId ? proposals.filter((p) => p.projectId === projectId) : proposals),
    [proposals, projectId],
  );
  const filteredCOs = useMemo(
    () => (projectId ? changeOrders.filter((c) => c.projectId === projectId) : changeOrders),
    [changeOrders, projectId],
  );

  const totals = useMemo(() => {
    let subtotal = 0;
    if (isLumpSum) {
      // One line; amount → subtotal.
      subtotal = Number(lumpAmount) || 0;
    } else {
      for (const l of lines) {
        subtotal = add(
          subtotal,
          multiply(Number(l.quantity) || 0, Number(l.unitCost) || 0),
        );
      }
    }
    // Auto-VAT from company.vatRatePercent unless user typed in the Tax
    // field. Keeps the displayed value in sync with subtotal as the user
    // edits line items.
    const autoTax =
      companyVatRatePercent > 0
        ? Math.round(((subtotal * companyVatRatePercent) / 100) * 100) / 100
        : 0;
    const tax = taxAmountManual ? Number(taxAmount) || 0 : autoTax;
    const pct = Number(retainagePercent) || 0;
    // Auto-derive retainage held from subtotal × pct unless the user has
    // manually overridden the held amount.
    const derivedHeld = pct > 0 ? (subtotal * pct) / 100 : 0;
    const retainage = retainageAmountManual
      ? Number(retainageAmount) || 0
      : Math.round(derivedHeld * 100) / 100;
    const total = subtract(add(subtotal, tax), retainage);
    const paid = Number(amountPaid) || 0;
    const balance = subtract(total, paid);
    return { subtotal, tax, retainage, total, paid, balance, pct };
  }, [
    lines,
    isLumpSum,
    lumpAmount,
    taxAmount,
    taxAmountManual,
    companyVatRatePercent,
    retainagePercent,
    retainageAmount,
    retainageAmountManual,
    amountPaid,
  ]);

  // Display value for the Tax field: when in auto mode, show the derived
  // amount so the user sees the math without having to compute it.
  const taxDisplay = taxAmountManual ? taxAmount : totals.tax.toFixed(2);

  // Keep the visible retainageAmount field synced with the derived value when
  // the user hasn't manually edited it.
  const retainageDisplay = retainageAmountManual
    ? retainageAmount
    : totals.retainage.toFixed(2);

  // In lump-sum mode, ship a single synthetic line so the existing data
  // path (lines table, totals math, reporting) keeps working.
  const linesPayload = isLumpSum
    ? [
        {
          description: lumpDescription || 'Lump sum billing',
          unit: '',
          quantity: '1',
          unitCost: lumpAmount || '0',
        },
      ]
    : lines.map((l) => ({
        description: l.description,
        unit: l.unit,
        quantity: l.quantity,
        unitCost: l.unitCost,
      }));

  const updateLine = (rowId: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.rowId === rowId ? { ...l, ...patch } : l)));

  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      <input type="hidden" name="lines" value={JSON.stringify(linesPayload)} />
      <input
        type="hidden"
        name="percentOfContract"
        value={isLumpSum ? percentOfContract : ''}
      />

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Invoice header</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Invoice number" error={err('number')} required>
            <Input name="number" defaultValue={defaultNumber} required />
          </Field>
          <Field label="Status" error={err('status')}>
            <Select name="status" defaultValue="draft">
              {invoiceStatusValues
                .filter((s) => s !== 'overdue')
                .map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Billing type" error={err('billingType')}>
            <Select
              name="billingType"
              value={billingType}
              onChange={(e) => setBillingType(e.target.value)}
            >
              {billingTypeValues.map((b) => (
                <option key={b} value={b}>
                  {BILLING_TYPE_LABEL[b]}
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
                {projects.length === 0 ? 'No projects' : 'Select a project'}
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Linked proposal (optional)" error={err('proposalId')}>
            <Select name="proposalId" defaultValue="">
              <option value="">— None —</option>
              {filteredProposals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Linked change order (optional)" error={err('changeOrderId')}>
            <Select name="changeOrderId" defaultValue="">
              <option value="">— None —</option>
              {filteredCOs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Template" error={err('templateId')}>
            <Select name="templateId" defaultValue="">
              <option value="">— Default (no template) —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Invoice date" error={err('invoiceDate')} required>
            <Input
              name="invoiceDate"
              type="date"
              defaultValue={defaultInvoiceDate}
              required
            />
          </Field>
          <Field label="Due date" error={err('dueDate')}>
            <Input name="dueDate" type="date" defaultValue={defaultDueDate} />
          </Field>
        </div>
      </fieldset>

      {isLumpSum && (
        <fieldset className="border border-slate-200 rounded-lg p-4 space-y-3">
          <legend className="px-2 text-sm font-medium text-slate-700">
            Lump sum billing
          </legend>
          <p className="text-xs text-slate-500">
            Single-line draw — enter what you&apos;re billing and the amount.
            Use &quot;% of contract&quot; for context (e.g. &quot;30% of
            contract&quot; on a progress draw); it&apos;s shown on the invoice
            but doesn&apos;t auto-compute the total.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-6">
              <Label className="text-xs">Description</Label>
              <Input
                value={lumpDescription}
                onChange={(e) => setLumpDescription(e.target.value)}
                placeholder="e.g. Foundation work — 30% draw"
              />
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs">Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={lumpAmount}
                onChange={(e) => setLumpAmount(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs">% of contract (optional)</Label>
              <Input
                type="number"
                step="0.001"
                value={percentOfContract}
                onChange={(e) => setPercentOfContract(e.target.value)}
                placeholder="e.g. 30"
                className="tabular-nums"
              />
            </div>
          </div>
        </fieldset>
      )}

      <fieldset
        className={
          'border border-slate-200 rounded-lg p-4 space-y-3 ' +
          (isLumpSum ? 'hidden' : '')
        }
      >
        <legend className="px-2 text-sm font-medium text-slate-700">
          Billing breakdown
        </legend>
        {err('lines') && <p className="text-xs text-red-600">{err('lines')}</p>}
        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-[2.5fr_0.7fr_0.6fr_0.9fr_1fr_auto] gap-2 px-1 text-xs font-medium text-slate-500">
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
                className="grid grid-cols-1 md:grid-cols-[2.5fr_0.7fr_0.6fr_0.9fr_1fr_auto] gap-2 items-start"
              >
                <Input
                  value={line.description}
                  onChange={(e) => updateLine(line.rowId, { description: e.target.value })}
                  placeholder="Description"
                />
                <Input
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.rowId, { quantity: e.target.value })}
                />
                <Input
                  value={line.unit}
                  onChange={(e) => updateLine(line.rowId, { unit: e.target.value })}
                  placeholder="lot"
                />
                <Input
                  inputMode="decimal"
                  value={line.unitCost}
                  onChange={(e) => updateLine(line.rowId, { unitCost: e.target.value })}
                />
                <div className="flex items-center justify-end h-10 px-2 text-sm tabular-nums">
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

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Totals</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field
            label={
              companyVatRatePercent > 0
                ? `Tax / VAT (${companyVatRatePercent.toFixed(2)}% auto)`
                : 'Tax / VAT'
            }
            error={err('taxAmount')}
          >
            <Input
              name="taxAmount"
              inputMode="decimal"
              value={taxDisplay}
              onChange={(e) => {
                setTaxAmount(e.target.value);
                setTaxAmountManual(true);
              }}
            />
            {companyVatRatePercent > 0 && taxAmountManual && (
              <button
                type="button"
                onClick={() => {
                  setTaxAmountManual(false);
                  setTaxAmount('0');
                }}
                className="mt-1 text-[11px] text-slate-500 hover:text-slate-900 underline"
              >
                Reset to auto ({companyVatRatePercent.toFixed(2)}% of subtotal)
              </button>
            )}
          </Field>
          <Field label="Retainage %" error={err('retainagePercent')}>
            <Input
              name="retainagePercent"
              inputMode="decimal"
              value={retainagePercent}
              onChange={(e) => {
                setRetainagePercent(e.target.value);
                setRetainageAmountManual(false);
              }}
              placeholder="e.g. 10"
            />
          </Field>
          <Field
            label={
              retainageAmountManual
                ? 'Retainage held (manual)'
                : 'Retainage held (auto from %)'
            }
            error={err('retainageAmount')}
          >
            <Input
              name="retainageAmount"
              inputMode="decimal"
              value={retainageDisplay}
              onChange={(e) => {
                setRetainageAmount(e.target.value);
                setRetainageAmountManual(true);
              }}
            />
          </Field>
          <Field
            label="Expected retainage release date"
            error={err('expectedRetainageReleaseDate')}
          >
            <Input
              name="expectedRetainageReleaseDate"
              type="date"
              value={expectedRetainageReleaseDate}
              onChange={(e) => setExpectedRetainageReleaseDate(e.target.value)}
            />
          </Field>
          <Field label="Amount paid" error={err('amountPaid')}>
            <Input
              name="amountPaid"
              inputMode="decimal"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
            />
          </Field>
        </div>
      </fieldset>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
        <Stat label="Subtotal" value={formatMoney(totals.subtotal)} />
        <Stat label="Tax / VAT" value={formatMoney(totals.tax)} />
        <Stat
          label={`Retainage held${totals.pct > 0 ? ` (${totals.pct.toFixed(2)}%)` : ''}`}
          value={formatMoney(totals.retainage)}
        />
        <Stat label="Net amount due" value={formatMoney(totals.total)} highlight />
        <Stat
          label="Balance due"
          value={formatMoney(totals.balance)}
          valueClassName={
            totals.balance <= 0
              ? 'text-emerald-700'
              : totals.balance > totals.total
                ? 'text-red-600'
                : 'text-slate-900'
          }
        />
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Notes & terms</legend>
        <TextareaField name="notes" label="Notes" rows={3} />
        <TextareaField
          name="termsOverride"
          label="Payment terms (override template)"
          rows={3}
        />
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create invoice'}
        </Button>
        <Link href="/invoices">
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
  required,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function TextareaField({
  name,
  label,
  rows,
}: {
  name: string;
  label: string;
  rows: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <textarea
        name={name}
        rows={rows}
        className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
  valueClassName,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-0.5 text-base font-semibold tabular-nums ${
          valueClassName ?? (highlight ? 'text-slate-900' : 'text-slate-800')
        }`}
      >
        {value}
      </p>
    </div>
  );
}
