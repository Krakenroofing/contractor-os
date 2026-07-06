'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { reconcileLandedCostAction } from '../actions';

// Toggles an entry between "estimate" and "reconciled" (actuals confirmed
// against the broker documents). The detail page shows estimate → actual
// variance regardless; this just records that the numbers have been verified.
export function ReconcileButton({
  id,
  reconciled,
}: {
  id: string;
  reconciled: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant={reconciled ? 'outline' : 'default'}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await reconcileLandedCostAction(id, !reconciled);
            setError(r.formError ?? null);
          })
        }
      >
        {pending
          ? 'Saving…'
          : reconciled
            ? '✓ Reconciled — undo'
            : 'Mark reconciled'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
