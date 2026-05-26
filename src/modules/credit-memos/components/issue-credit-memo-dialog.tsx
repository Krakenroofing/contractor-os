'use client';

// Shared "Issue credit memo" dialog. Rendered from /invoices/[id],
// /projects/[id], and /customers/[id] — each callsite pre-fills the
// scope (invoice / project / customer) so the operator only fills the
// amount + reason + mode.
//
// Mode picker:
//   - apply_to_invoice — net it immediately against the linked invoice.
//     Requires invoiceId in scope. Reduces the invoice's net billed.
//   - refund_cash      — cash refund out the door. Asks for bank + ref.
//   - open             — leave as an unapplied credit on the customer
//                        for future invoices.

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  issueCreditMemoAction,
  type IssueCreditMemoState,
} from '../actions';

const initial: IssueCreditMemoState = {};

export type IssueCreditMemoScope = {
  customerId: string;
  customerName: string;
  projectId: string | null;
  projectName: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** Pre-fill the amount field. Caller computes a sensible default
   *  (e.g. invoice subtotal − applied credits). */
  defaultAmount?: number;
  /** If true, show a follow-up nudge after save that links to /change-orders/new
   *  with a pre-filled deduct CO matching the credit amount. */
  suggestDeductCO?: boolean;
};

function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function IssueCreditMemoDialog({
  scope,
  triggerLabel = 'Issue credit memo',
  triggerVariant = 'outline',
}: {
  scope: IssueCreditMemoScope;
  triggerLabel?: string;
  triggerVariant?: 'outline' | 'default' | 'ghost';
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    issueCreditMemoAction,
    initial,
  );
  const [amount, setAmount] = useState<string>(
    scope.defaultAmount && scope.defaultAmount > 0
      ? scope.defaultAmount.toFixed(2)
      : '',
  );
  const [mode, setMode] = useState<'apply_to_invoice' | 'refund_cash' | 'open'>(
    scope.invoiceId ? 'apply_to_invoice' : 'open',
  );

  // After a successful save, leave the dialog visible long enough to show
  // the deduct-CO suggestion if applicable. Closes when the user
  // dismisses or clicks the CO link.
  const justSaved = state.okCreditId !== undefined;

  if (!open) {
    return (
      <Button
        type="button"
        variant={triggerVariant}
        onClick={() => setOpen(true)}
        size="sm"
      >
        {triggerLabel}
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            Issue credit memo
          </h2>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-900 text-sm"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>

        {justSaved ? (
          <div className="p-5 space-y-4 text-sm">
            <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-emerald-900">
              ✓ Credit memo issued. The customer&apos;s open balance and
              the relevant invoice / project pages will reflect the
              change.
            </div>
            {scope.suggestDeductCO && scope.projectId && amount !== '' && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-3 text-amber-900 space-y-2">
                <p className="font-medium">
                  Reduce contract value by a deduct change order?
                </p>
                <p className="text-xs">
                  Standard practice when a scope is canceled: issue a
                  matching deduct CO of −${amount} so the project&apos;s
                  revised contract value stays in sync.
                </p>
                <a
                  href={`/change-orders/new?projectId=${scope.projectId}&amount=-${amount}`}
                  className="inline-block text-blue-700 hover:underline text-xs font-medium"
                >
                  Open deduct CO form pre-filled →
                </a>
              </div>
            )}
            <div className="flex justify-end pt-2 border-t border-slate-200">
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form action={formAction} className="p-5 space-y-4 text-sm">
            {state.formError && (
              <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {state.formError}
              </div>
            )}

            <input type="hidden" name="customerId" value={scope.customerId} />
            <input type="hidden" name="projectId" value={scope.projectId ?? ''} />
            <input type="hidden" name="invoiceId" value={scope.invoiceId ?? ''} />

            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700 space-y-0.5">
              <div>
                <span className="text-slate-500">Customer:</span>{' '}
                <strong>{scope.customerName}</strong>
              </div>
              {scope.projectName && (
                <div>
                  <span className="text-slate-500">Project:</span>{' '}
                  <strong>{scope.projectName}</strong>
                </div>
              )}
              {scope.invoiceNumber && (
                <div>
                  <span className="text-slate-500">Invoice:</span>{' '}
                  <span className="font-mono">{scope.invoiceNumber}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>
                  Issue date <span className="text-red-600">*</span>
                </Label>
                <Input
                  name="issueDate"
                  type="date"
                  defaultValue={todayLocalISO()}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Amount <span className="text-red-600">*</span>
                </Label>
                <Input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
                {state.errors?.amount?.[0] && (
                  <p className="text-xs text-red-600">{state.errors.amount[0]}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>
                Reason <span className="text-red-600">*</span>
              </Label>
              <Input
                name="reason"
                placeholder="Job canceled mid-flight — refund over-billed portion"
                maxLength={500}
                required
              />
              {state.errors?.reason?.[0] && (
                <p className="text-xs text-red-600">{state.errors.reason[0]}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>
                What to do with the credit <span className="text-red-600">*</span>
              </Label>
              <Select
                name="mode"
                value={mode}
                onChange={(e) =>
                  setMode(e.target.value as typeof mode)
                }
              >
                {scope.invoiceId && (
                  <option value="apply_to_invoice">
                    Apply to this invoice (reduces what they owe)
                  </option>
                )}
                <option value="refund_cash">
                  Refund cash (check / wire to customer)
                </option>
                <option value="open">
                  Leave as open credit (applies to future invoices)
                </option>
              </Select>
              {!scope.invoiceId && mode === 'apply_to_invoice' && (
                <p className="text-xs text-amber-700">
                  No invoice in scope — pick a different mode.
                </p>
              )}
            </div>

            {mode === 'refund_cash' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-200 pt-4">
                <div className="space-y-1.5">
                  <Label>Bank account (optional)</Label>
                  <Input
                    name="refundBankAccount"
                    placeholder="Operating · Royal Bank #1234"
                    maxLength={120}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Check / wire reference (optional)</Label>
                  <Input
                    name="refundReference"
                    placeholder="Check #1042"
                    maxLength={120}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <textarea
                name="notes"
                rows={2}
                maxLength={2000}
                className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="Anything else for the audit trail?"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Issuing…' : 'Issue credit'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
