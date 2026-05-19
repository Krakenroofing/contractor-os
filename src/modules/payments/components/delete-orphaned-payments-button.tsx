'use client';

// Two-click confirmation button that triggers the orphaned-payments cleanup
// for one voided invoice. Reused on both the voided-invoice detail page and
// the /settings/diagnostics card so the cleanup verb is the same wherever
// the operator sees the problem.

import { useActionState } from 'react';
import { ConfirmButton } from '@/components/ui/confirm-button';
import {
  deleteOrphanedPaymentsAction,
  type DeleteOrphanedPaymentsState,
} from '@/modules/payments/actions';

const initialState: DeleteOrphanedPaymentsState = {};

export function DeleteOrphanedPaymentsButton({
  invoiceId,
  paymentCount,
  size = 'sm',
}: {
  invoiceId: string;
  paymentCount: number;
  size?: 'sm' | 'md';
}) {
  const [state, action] = useActionState(
    deleteOrphanedPaymentsAction,
    initialState,
  );

  return (
    <div className="space-y-1">
      <form action={action}>
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <ConfirmButton
          size={size}
          variant="outline"
          confirmLabel={`Click again to delete ${paymentCount} payment${
            paymentCount === 1 ? '' : 's'
          }`}
          pendingLabel="Deleting…"
        >
          Delete orphaned {paymentCount === 1 ? 'payment' : 'payments'}
        </ConfirmButton>
      </form>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
      {state.ok && state.result && (
        <p className="text-xs text-emerald-700">
          Deleted {state.result.deletedCount} row
          {state.result.deletedCount === 1 ? '' : 's'}.
        </p>
      )}
    </div>
  );
}
