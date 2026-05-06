'use client';

import { useActionState } from 'react';
import { ConfirmButton } from '@/components/ui/confirm-button';
import {
  archiveCustomerAction,
  type ArchiveCustomerState,
} from '../actions';

const initial: ArchiveCustomerState = {};

export function ArchiveCustomerForm({ id }: { id: string }) {
  const [state, formAction] = useActionState(archiveCustomerAction, initial);

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <ConfirmButton size="sm" confirmLabel="Click again to archive" pendingLabel="Archiving…">
        Archive
      </ConfirmButton>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
    </form>
  );
}
