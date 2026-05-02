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
}: {
  projects: InvoiceFormProjectOption[];
  proposals: InvoiceFormProposalOption[];
  changeOrders: InvoiceFormChangeOrderOption[];
  templates: InvoiceFormTemplateOption[];
  defaultNumber: string;
  defaultInvoiceDate: string;
  defaultDueDate: string;
}) {
  const [state, formAction, pending] = useActionState(createInvoiceAction, initialState);
  const [lines, setLines] = useState<LineDraft[]>([newEmptyLine()]);
  const [projectId, setProjectId] = useState('');
  const [taxAmount, setTaxAmount] = useState('0');
  const [retainagePercent, setRetainagePercent] = useState('0');
  const [retainageAmount, setRetainageAmount] = useState('0');
  const [retainageAmountManual, setRetainageAmountManual] = useState(false);
  const [expectedRetainageReleaseDate, setExpectedRetainageReleaseDate] = useState('');
  const [amountPaid, setAmountPaid] = useState('0');

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
    for (const l of lines) {
      subtotal = add(
        subtotal,
        multiply(Number(l.quantity) || 0, Number(l.unitCost) || 0),
      );
    }
    const tax = Number(taxAmount) || 0;
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
  }, [lines, taxAmount, retainagePercent, retainageAmount, retainageAmountManual, amountPaid]);

  // Keep the visible retainageAmount field synced with the derived value when
  // the user hasn't manually edited it.
  const retainageDisplay = retainageAmountManual
    ? retainageAmount
    : totals.retainage.toFixed(2);

  const linesPayload = lines.map((l) => ({
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
            <Select name="billingType" defaultValue="progress">
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

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-3">
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
          <Field label="Tax / VAT" error={err('taxAmount')}>
            <Input
              name="taxAmount"
              inputMode="decimal"
              value={taxAmount}
              onChange={(e) => setTaxAmount(e.target.value)}
            />
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
