'use client';

// Per-row unapply button + the "manage" panel with apply / refund / void
// inline forms. Lives on /credit-memos/[id] so the operator can drive
// the credit's entire lifecycle from one page.

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  applyCreditToInvoiceAction,
  refundCreditMemoAction,
  unapplyCreditMemoApplicationAction,
  updateCreditMemoAction,
  voidCreditMemoAction,
  type ApplyCreditState,
} from '../actions';

const initial: ApplyCreditState = {};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type UnapplyProps = { mode: 'unapply'; applicationId: string };

type ManageProps = {
  mode: 'manage';
  creditMemoId: string;
  openBalance: number;
  customerInvoices: Array<{ id: string; number: string }>;
  canVoid: boolean;
  /** Current values for the Edit tab. */
  current?: CreditMemoCurrent;
};

export type CreditMemoCurrent = {
  issueDate: string;
  amount: number;
  appliedAmount: number;
  reason: string;
  notes: string | null;
  invoiceId: string | null;
  /** Amount locked: the credit booked a matching deduct CO. */
  hasDeductCO: boolean;
};

export function CreditMemoDetailActions(props: UnapplyProps | ManageProps) {
  if (props.mode === 'unapply') {
    return <UnapplyButton applicationId={props.applicationId} />;
  }
  return (
    <ManagePanel
      creditMemoId={props.creditMemoId}
      openBalance={props.openBalance}
      customerInvoices={props.customerInvoices}
      canVoid={props.canVoid}
      current={props.current}
    />
  );
}

function UnapplyButton({ applicationId }: { applicationId: string }) {
  const [state, formAction, pending] = useActionState(
    unapplyCreditMemoApplicationAction,
    initial,
  );
  return (
    <>
      <form
        action={formAction}
        onSubmit={(e) => {
          if (
            !window.confirm(
              'Reverse this application? The credit memo will return that amount to its open balance and the linked invoice / refund record is removed.',
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="applicationId" value={applicationId} />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Unapply
        </Button>
      </form>
      {state.formError && (
        <p className="text-xs text-red-600 mt-1">{state.formError}</p>
      )}
    </>
  );
}

function ManagePanel({
  creditMemoId,
  openBalance,
  customerInvoices,
  canVoid,
  current,
}: {
  creditMemoId: string;
  openBalance: number;
  customerInvoices: Array<{ id: string; number: string }>;
  canVoid: boolean;
  current?: CreditMemoCurrent;
}) {
  const [tab, setTab] = useState<'apply' | 'refund' | 'void' | 'edit' | null>(
    null,
  );
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">Manage this credit</h3>
      <div className="flex items-center gap-2">
        {current && (
          <Button
            type="button"
            size="sm"
            variant={tab === 'edit' ? 'default' : 'outline'}
            onClick={() => setTab(tab === 'edit' ? null : 'edit')}
          >
            Edit details
          </Button>
        )}
        {openBalance > 0 && customerInvoices.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant={tab === 'apply' ? 'default' : 'outline'}
            onClick={() => setTab(tab === 'apply' ? null : 'apply')}
          >
            Apply to invoice
          </Button>
        )}
        {openBalance > 0 && (
          <Button
            type="button"
            size="sm"
            variant={tab === 'refund' ? 'default' : 'outline'}
            onClick={() => setTab(tab === 'refund' ? null : 'refund')}
          >
            Refund cash
          </Button>
        )}
        {canVoid && (
          <Button
            type="button"
            size="sm"
            variant={tab === 'void' ? 'destructive' : 'outline'}
            onClick={() => setTab(tab === 'void' ? null : 'void')}
          >
            Void credit
          </Button>
        )}
      </div>

      {tab === 'edit' && current && (
        <EditForm
          creditMemoId={creditMemoId}
          current={current}
          customerInvoices={customerInvoices}
        />
      )}
      {tab === 'apply' && (
        <ApplyForm
          creditMemoId={creditMemoId}
          openBalance={openBalance}
          customerInvoices={customerInvoices}
        />
      )}
      {tab === 'refund' && (
        <RefundForm creditMemoId={creditMemoId} openBalance={openBalance} />
      )}
      {tab === 'void' && <VoidForm creditMemoId={creditMemoId} />}
    </div>
  );
}

function EditForm({
  creditMemoId,
  current,
  customerInvoices,
}: {
  creditMemoId: string;
  current: CreditMemoCurrent;
  customerInvoices: Array<{ id: string; number: string }>;
}) {
  const [state, formAction, pending] = useActionState(
    updateCreditMemoAction,
    initial,
  );
  const [invoiceId, setInvoiceId] = useState(current.invoiceId ?? '');
  return (
    <form action={formAction} className="space-y-3 border-t border-slate-200 pt-3">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {state.formError}
        </div>
      )}
      {state.ok && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
          ✓ Saved.
        </div>
      )}
      <input type="hidden" name="creditMemoId" value={creditMemoId} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Issue date" error={state.errors?.issueDate?.[0]}>
          <Input
            name="issueDate"
            type="date"
            defaultValue={current.issueDate}
            required
          />
        </Field>
        <Field
          label={
            current.hasDeductCO
              ? 'Amount (locked — deduct CO)'
              : current.appliedAmount > 0.005
                ? `Amount (min ${current.appliedAmount.toFixed(2)} applied)`
                : 'Amount'
          }
          error={state.errors?.amount?.[0]}
        >
          <Input
            name="amount"
            type="number"
            step="0.01"
            defaultValue={current.amount.toFixed(2)}
            readOnly={current.hasDeductCO}
            title={
              current.hasDeductCO
                ? 'This credit booked a matching deduct change order — void both and reissue to change the amount.'
                : undefined
            }
            required
          />
        </Field>
        <Field label="Invoice this credit relates to" error={state.errors?.invoiceId?.[0]}>
          <Select
            name="invoiceId"
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
          >
            <option value="">— No specific invoice —</option>
            {customerInvoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Reason" error={state.errors?.reason?.[0]}>
        <Input name="reason" defaultValue={current.reason} maxLength={500} required />
      </Field>
      <Field label="Notes (optional)">
        <Input name="notes" defaultValue={current.notes ?? ''} maxLength={2000} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
}

function ApplyForm({
  creditMemoId,
  openBalance,
  customerInvoices,
}: {
  creditMemoId: string;
  openBalance: number;
  customerInvoices: Array<{ id: string; number: string }>;
}) {
  const [state, formAction, pending] = useActionState(
    applyCreditToInvoiceAction,
    initial,
  );
  return (
    <form action={formAction} className="space-y-3 border-t border-slate-200 pt-3">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {state.formError}
        </div>
      )}
      {state.ok && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
          ✓ Applied.
        </div>
      )}
      <input type="hidden" name="creditMemoId" value={creditMemoId} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Invoice" error={state.errors?.invoiceId?.[0]}>
          <Select name="invoiceId" defaultValue="" required>
            <option value="" disabled>
              Pick an invoice
            </option>
            {customerInvoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" error={state.errors?.appliedAt?.[0]}>
          <Input
            name="appliedAt"
            type="date"
            defaultValue={todayISO()}
            required
          />
        </Field>
        <Field label={`Amount (open: ${openBalance.toFixed(2)})`} error={state.errors?.amount?.[0]}>
          <Input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            max={openBalance}
            defaultValue={openBalance.toFixed(2)}
            required
          />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <Input name="notes" maxLength={2000} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Applying…' : 'Apply credit'}
      </Button>
    </form>
  );
}

function RefundForm({
  creditMemoId,
  openBalance,
}: {
  creditMemoId: string;
  openBalance: number;
}) {
  const [state, formAction, pending] = useActionState(
    refundCreditMemoAction,
    initial,
  );
  return (
    <form action={formAction} className="space-y-3 border-t border-slate-200 pt-3">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {state.formError}
        </div>
      )}
      {state.ok && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
          ✓ Refunded.
        </div>
      )}
      <input type="hidden" name="creditMemoId" value={creditMemoId} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Refund date" error={state.errors?.appliedAt?.[0]}>
          <Input
            name="appliedAt"
            type="date"
            defaultValue={todayISO()}
            required
          />
        </Field>
        <Field label={`Amount (open: ${openBalance.toFixed(2)})`} error={state.errors?.amount?.[0]}>
          <Input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            max={openBalance}
            defaultValue={openBalance.toFixed(2)}
            required
          />
        </Field>
        <Field label="Bank account (optional)">
          <Input
            name="bankAccount"
            placeholder="Operating · Royal Bank #1234"
            maxLength={120}
          />
        </Field>
        <Field label="Reference (optional)">
          <Input name="reference" placeholder="Check #1042" maxLength={120} />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <Input name="notes" maxLength={2000} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Refunding…' : 'Record refund'}
      </Button>
    </form>
  );
}

function VoidForm({ creditMemoId }: { creditMemoId: string }) {
  const [state, formAction, pending] = useActionState(
    voidCreditMemoAction,
    initial,
  );
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            'Void this credit memo? Only possible when no applications have been made. The memo stays in history but is excluded from open-balance + AR reports.',
          )
        ) {
          e.preventDefault();
        }
      }}
      className="space-y-3 border-t border-slate-200 pt-3"
    >
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {state.formError}
        </div>
      )}
      <input type="hidden" name="id" value={creditMemoId} />
      <p className="text-xs text-slate-600">
        Voids the credit memo. Available only when no applications exist —
        unapply each application first if needed.
      </p>
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? 'Voiding…' : 'Void credit memo'}
      </Button>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
