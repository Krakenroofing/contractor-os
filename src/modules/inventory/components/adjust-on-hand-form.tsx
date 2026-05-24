'use client';

// Phase 6.3: manual on-hand adjustment. One row → one inventory_movement
// with movement_type=adjustment, signed quantity (positive for over-count,
// negative for waste/theft/correction). Required reason note becomes the
// movement's audit text.

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  recordInventoryAdjustmentAction,
  type RecordAdjustmentState,
} from '../actions';

const initial: RecordAdjustmentState = {};

export function AdjustOnHandForm({
  itemId,
  unit,
  onHand,
}: {
  itemId: string;
  unit: string | null;
  onHand: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    recordInventoryAdjustmentAction,
    initial,
  );
  const [delta, setDelta] = useState<string>('');

  // Successful submit returns an empty state — close the modal then.
  // (formError/errors absent and we know it ran.) The action revalidates
  // /inventory/[id] so the on-hand panel above will refresh.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    // useActionState dispatches via the form action — no need to call
    // anything extra. We just optimistically close after the parent
    // re-renders with no errors. Use a microtask-style close on next
    // render below via useEffect-pattern would be cleaner, but for this
    // small flow a simple "submit then close" works.
    // (No preventDefault — let the action fire.)
    void e;
    setTimeout(() => {
      if (!state.formError && !state.errors) {
        setOpen(false);
        setDelta('');
      }
    }, 0);
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        Adjust on-hand
      </Button>
    );
  }

  const parsedDelta = Number(delta || '0');
  const projected = Number.isFinite(parsedDelta) ? onHand + parsedDelta : onHand;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Adjust on-hand</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              setDelta('');
            }}
          >
            ✕
          </Button>
        </div>
        <form action={formAction} onSubmit={handleSubmit} className="p-5 space-y-4">
          {state.formError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {state.formError}
            </div>
          )}
          <input type="hidden" name="inventoryItemId" value={itemId} />

          <div className="space-y-1.5">
            <Label>
              Change in on-hand{unit ? ` (${unit})` : ''}{' '}
              <span className="text-red-600">*</span>
            </Label>
            <Input
              name="delta"
              inputMode="decimal"
              placeholder="e.g. -3 for write-off, 5 for found surplus"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
            />
            {state.errors?.delta?.[0] && (
              <p className="text-xs text-red-600">{state.errors.delta[0]}</p>
            )}
            <p className="text-xs text-slate-500">
              Current on-hand:{' '}
              <span className="tabular-nums">{onHand.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>.
              After this adjustment:{' '}
              <span
                className={`tabular-nums font-medium ${
                  projected < 0 ? 'text-red-700' : 'text-slate-900'
                }`}
              >
                {projected.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
              {projected < 0 && ' (negative — allowed, but check your numbers)'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>
              Reason <span className="text-red-600">*</span>
            </Label>
            <textarea
              name="reason"
              rows={2}
              required
              maxLength={500}
              placeholder="Physical count discovered 3 fewer boxes; suspected miscount during last receipt."
              className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
            {state.errors?.reason?.[0] && (
              <p className="text-xs text-red-600">{state.errors.reason[0]}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setDelta('');
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || delta.trim() === '' || parsedDelta === 0}>
              {pending ? 'Saving…' : 'Record adjustment'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
