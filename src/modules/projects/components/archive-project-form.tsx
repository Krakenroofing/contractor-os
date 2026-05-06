'use client';

import { useActionState } from 'react';
import { ConfirmButton } from '@/components/ui/confirm-button';
import {
  archiveProjectAction,
  type ArchiveProjectState,
} from '../actions';

const initial: ArchiveProjectState = {};

export function ArchiveProjectForm({ id }: { id: string }) {
  const [state, formAction] = useActionState(archiveProjectAction, initial);

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
