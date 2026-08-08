'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { reopenReconciliationAction } from '../reconcile-actions';

/** Reopen button for a completed reconciliation row on the history list. */
export function ReopenReconciliationButton({
  reconciliationId,
  label,
}: {
  reconciliationId: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (
      !confirm(
        `Reopen the ${label} reconciliation?\n\nIts transactions stay checked — you can adjust and finish it again.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await reopenReconciliationAction(reconciliationId);
      if (res?.formError) setError(res.formError);
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={onClick} disabled={pending}>
        {pending ? 'Reopening…' : 'Reopen'}
      </Button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}
