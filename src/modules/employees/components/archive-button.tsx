'use client';

import { useActionState } from 'react';
import { ConfirmButton } from '@/components/ui/confirm-button';
import {
  archiveEmployeeAction,
  type ArchiveEmployeeState,
} from '../actions';

export function ArchiveButton({ employeeId }: { employeeId: string }) {
  const [state, formAction] = useActionState<ArchiveEmployeeState, FormData>(
    archiveEmployeeAction,
    {},
  );

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={employeeId} />
      <ConfirmButton
        size="md"
        variant="destructive"
        confirmLabel="Click again to archive"
      >
        Archive
      </ConfirmButton>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
    </form>
  );
}
