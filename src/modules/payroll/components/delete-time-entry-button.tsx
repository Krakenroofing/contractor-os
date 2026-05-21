'use client';

import { useActionState } from 'react';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { deleteTimeEntryAction, type TimeEntryState } from '../actions';

export function DeleteTimeEntryButton({ entryId }: { entryId: string }) {
  const [state, formAction] = useActionState<TimeEntryState, FormData>(
    deleteTimeEntryAction,
    {},
  );

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={entryId} />
      <ConfirmButton
        size="md"
        variant="destructive"
        confirmLabel="Click again to delete"
      >
        Delete entry
      </ConfirmButton>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
    </form>
  );
}
