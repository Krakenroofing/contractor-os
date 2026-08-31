'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import {
  lockPeriodAction,
  unlockPeriodAction,
  type LockPeriodState,
} from '../actions';

/**
 * Lock / Unlock button for the current pay period. Locking is the
 * explicit "post pay" step — it freezes paystubs so subsequent rate
 * changes on the employee record can't rewrite history. Unlocking
 * clears the frozen snapshot and goes back to live recompute.
 *
 * Lock is one-tap (no confirm — typical workflow at end of week).
 * Unlock requires a two-tap confirm via ConfirmButton since it's the
 * destructive operation (undoes the freeze).
 */
export function PeriodLockButton({
  payPeriodId,
  locked,
}: {
  payPeriodId: string;
  locked: boolean;
}) {
  const [lockState, lockAction, lockPending] = useActionState<
    LockPeriodState,
    FormData
  >(lockPeriodAction, {});
  const [unlockState, unlockAction] = useActionState<
    LockPeriodState,
    FormData
  >(unlockPeriodAction, {});

  if (locked) {
    return (
      <form action={unlockAction} className="inline-flex flex-col items-end gap-1">
        <input type="hidden" name="payPeriodId" value={payPeriodId} />
        <ConfirmButton
          size="sm"
          variant="outline"
          confirmLabel="Click again to unlock"
        >
          Unlock period
        </ConfirmButton>
        {unlockState.formError && (
          <p className="text-xs text-red-600">{unlockState.formError}</p>
        )}
        {/* Post-lock bill-sync summary — the lock just happened in this
            component instance, so surface it here even though the button
            has flipped to Unlock. */}
        {lockState.notice && (
          <p className="max-w-md text-right text-xs text-amber-700">
            {lockState.notice}
          </p>
        )}
      </form>
    );
  }

  return (
    <form action={lockAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="payPeriodId" value={payPeriodId} />
      <Button type="submit" size="sm" disabled={lockPending}>
        {lockPending ? 'Locking…' : 'Lock & post period'}
      </Button>
      {lockState.formError && (
        <p className="text-xs text-red-600">{lockState.formError}</p>
      )}
    </form>
  );
}
