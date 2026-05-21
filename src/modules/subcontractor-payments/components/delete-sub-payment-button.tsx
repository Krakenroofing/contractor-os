'use client';

import { useActionState } from 'react';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { deleteSubPaymentAction, type SubPaymentState } from '../actions';

export function DeleteSubPaymentButton({ paymentId }: { paymentId: string }) {
  const [state, formAction] = useActionState<SubPaymentState, FormData>(
    deleteSubPaymentAction,
    {},
  );

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={paymentId} />
      <ConfirmButton
        size="md"
        variant="destructive"
        confirmLabel="Click again to delete"
      >
        Delete
      </ConfirmButton>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
    </form>
  );
}
