'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { deleteLandedCostAction } from '../actions';

// Two-click delete for a landed-cost entry. On success the action redirects to
// the list; on failure it returns a message shown inline.
export function DeleteEntryButton({ id }: { id: string }) {
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant={armed ? 'destructive' : 'outline'}
        disabled={pending}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            setTimeout(() => setArmed(false), 4000);
            return;
          }
          start(async () => {
            const r = await deleteLandedCostAction(id);
            if (r?.formError) setError(r.formError);
          });
        }}
      >
        {pending ? 'Deleting…' : armed ? 'Click again to delete' : 'Delete'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
