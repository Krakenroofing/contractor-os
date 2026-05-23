'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import {
  archiveInventoryItemAction,
  unarchiveInventoryItemAction,
} from '../actions';

export function ArchiveProductForm({
  id,
  archived,
}: {
  id: string;
  archived: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    archived ? unarchiveInventoryItemAction : archiveInventoryItemAction,
    {} as { formError?: string },
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant={archived ? 'outline' : 'ghost'}
        disabled={pending}
      >
        {archived ? 'Restore' : 'Archive'}
      </Button>
      {state.formError && (
        <span className="ml-2 text-xs text-red-600">{state.formError}</span>
      )}
    </form>
  );
}
