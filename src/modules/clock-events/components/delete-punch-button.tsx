'use client';

import { ConfirmButton } from '@/components/ui/confirm-button';
import { deletePunchAction } from '../actions';

export function DeletePunchButton({ punchId }: { punchId: string }) {
  return (
    <form action={deletePunchAction.bind(null, punchId)} className="inline">
      <ConfirmButton size="sm" variant="ghost" confirmLabel="Confirm delete">
        Delete
      </ConfirmButton>
    </form>
  );
}
