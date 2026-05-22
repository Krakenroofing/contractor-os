'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatMoney } from '@/lib/money';
import {
  ADJUSTMENT_TYPE_LABEL,
  adjustmentTypeValues,
  type AdjustmentType,
} from '@/db/schema';
import {
  addPaystubAdjustmentAction,
  deletePaystubAdjustmentAction,
  type PaystubAdjustmentState,
} from '../actions';
import type { PaystubLineItem } from '../lib/payroll-math';

/**
 * Inline editor for deduction / reimbursement / per-diem / expense line
 * items on each paystub. Shows the current list grouped by type, with a
 * single inline "Add line item" form at the bottom. Each row is its
 * own delete-form so removal works without JS-level state.
 *
 * Deductions display in red (subtracted pre-NIB); other categories in
 * emerald (added post-NIB, NIB-exempt).
 */
export function PaystubAdjustmentsEditor({
  employeeId,
  payPeriodId,
  deductions,
  additions,
  locked,
}: {
  employeeId: string;
  payPeriodId: string;
  deductions: PaystubLineItem[];
  additions: PaystubLineItem[];
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const all = [...deductions, ...additions];

  if (!open && all.length === 0 && locked) {
    return null;
  }
  if (!open && all.length === 0) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-blue-600 hover:underline"
      >
        Add deduction / reimbursement / per diem / expense
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {all.length > 0 && (
        <ul className="space-y-1 text-sm">
          {all.map((item) => (
            <LineItemRow
              key={item.id}
              item={item}
              locked={locked}
            />
          ))}
        </ul>
      )}

      {!locked && (
        <>
          {open ? (
            <AddForm
              employeeId={employeeId}
              payPeriodId={payPeriodId}
              onCancel={() => setOpen(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-xs text-blue-600 hover:underline"
            >
              + Add another line item
            </button>
          )}
        </>
      )}
    </div>
  );
}

function LineItemRow({
  item,
  locked,
}: {
  item: PaystubLineItem;
  locked: boolean;
}) {
  const [state, action, pending] = useActionState<
    PaystubAdjustmentState,
    FormData
  >(deletePaystubAdjustmentAction, {});
  const isDeduction = item.type === 'deduction';
  const amountColor = isDeduction ? 'text-red-600' : 'text-emerald-700';
  const sign = isDeduction ? '−' : '+';
  return (
    <li className="flex items-start justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium uppercase tracking-wide text-slate-500">
            {ADJUSTMENT_TYPE_LABEL[item.type]}
          </span>
          {item.description && (
            <span className="truncate text-slate-700">{item.description}</span>
          )}
        </div>
        {state.formError && (
          <p className="mt-1 text-xs text-red-600">{state.formError}</p>
        )}
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className={`tabular-nums font-medium ${amountColor}`}>
          {sign}
          {formatMoney(item.amount)}
        </span>
        {!locked && (
          <form action={action}>
            <input type="hidden" name="id" value={item.id} />
            <button
              type="submit"
              disabled={pending}
              className="text-xs text-slate-400 hover:text-red-600"
              aria-label="Delete line item"
            >
              ×
            </button>
          </form>
        )}
      </div>
    </li>
  );
}

function AddForm({
  employeeId,
  payPeriodId,
  onCancel,
}: {
  employeeId: string;
  payPeriodId: string;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState<
    PaystubAdjustmentState,
    FormData
  >(addPaystubAdjustmentAction, {});
  return (
    <form
      action={action}
      className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2"
    >
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="payPeriodId" value={payPeriodId} />
      <div className="grid grid-cols-1 sm:grid-cols-[160px_120px_1fr] gap-2">
        <Select name="type" defaultValue="deduction" required>
          {adjustmentTypeValues.map((t) => (
            <option key={t} value={t}>
              {ADJUSTMENT_TYPE_LABEL[t as AdjustmentType]}
            </option>
          ))}
        </Select>
        <Input
          type="number"
          step="0.01"
          min="0"
          name="amount"
          placeholder="0.00"
          className="text-right tabular-nums"
          required
        />
        <Input
          type="text"
          name="description"
          placeholder="Description (prints on paystub)"
          maxLength={500}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Adding…' : 'Add line item'}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-500 hover:underline"
        >
          Cancel
        </button>
        {state.fieldError && (
          <p className="text-xs text-red-600">{state.fieldError}</p>
        )}
        {state.formError && (
          <p className="text-xs text-red-600">{state.formError}</p>
        )}
      </div>
    </form>
  );
}
