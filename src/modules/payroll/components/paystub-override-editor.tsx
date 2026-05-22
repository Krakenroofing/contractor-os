'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  clearPayOverrideAction,
  savePayOverrideAction,
  type PayOverrideState,
} from '../actions';

/**
 * Inline editor surfaced on each paystub card. Closed state is just a
 * link; open state expands into a small form with a gross input + a
 * pay-description textarea + Save / Clear. The description prints on
 * the paystub like a check memo / slip line so contract employees can
 * see exactly what they were paid for.
 */
export function PaystubOverrideEditor({
  employeeId,
  payPeriodId,
  currentGross,
  currentNotes,
  hasOverride,
}: {
  employeeId: string;
  payPeriodId: string;
  currentGross: number;
  currentNotes: string | null;
  hasOverride: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saveState, saveAction, savePending] = useActionState<
    PayOverrideState,
    FormData
  >(savePayOverrideAction, {});
  const [clearState, clearAction, clearPending] = useActionState<
    PayOverrideState,
    FormData
  >(clearPayOverrideAction, {});

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-blue-600 hover:underline"
      >
        {hasOverride ? 'Edit override / description' : 'Override gross / add description'}
      </button>
    );
  }

  const fieldErr = saveState.fieldError;
  const formErr = saveState.formError ?? clearState.formError;

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
      <form action={saveAction} className="space-y-2">
        <input type="hidden" name="employeeId" value={employeeId} />
        <input type="hidden" name="payPeriodId" value={payPeriodId} />
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600 whitespace-nowrap">
            Gross this period
          </label>
          <Input
            type="number"
            step="0.01"
            min="0"
            name="grossAmount"
            defaultValue={hasOverride ? currentGross.toFixed(2) : ''}
            placeholder="0.00"
            className="text-right tabular-nums max-w-[120px]"
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-600">
            Pay description (prints on the paystub)
          </label>
          <textarea
            name="notes"
            rows={2}
            defaultValue={currentNotes ?? ''}
            placeholder="e.g. Roof repair at 123 Main St — labor only"
            className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <Button type="submit" size="sm" disabled={savePending}>
          {savePending ? 'Saving…' : 'Save'}
        </Button>
        {fieldErr && <p className="text-xs text-red-600">{fieldErr}</p>}
      </form>

      <div className="flex items-center gap-2">
        {hasOverride && (
          <form action={clearAction}>
            <input type="hidden" name="employeeId" value={employeeId} />
            <input type="hidden" name="payPeriodId" value={payPeriodId} />
            <button
              type="submit"
              className="text-xs text-red-600 hover:underline"
              disabled={clearPending}
            >
              {clearPending ? 'Clearing…' : 'Clear override'}
            </button>
          </form>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-slate-500 hover:underline"
        >
          Cancel
        </button>
      </div>
      {formErr && <p className="text-xs text-red-600">{formErr}</p>}
    </div>
  );
}
