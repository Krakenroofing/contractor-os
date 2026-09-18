'use client';

// Hard-delete for a MANUAL journal entry — the escape hatch for a test or
// mistyped entry. Reversal stays the right tool once an entry has history,
// so this asks for confirmation and says what it removes.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { deleteManualJournalEntryAction } from '../gl-actions';

export function DeleteEntryButton({
  entryId,
  label,
}: {
  entryId: string;
  /** Date + memo, so the confirm names the entry being removed. */
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        className="text-red-700 hover:bg-red-50"
        onClick={() => {
          if (
            !window.confirm(
              `Delete this journal entry (${label})?\n\nIt is removed from the ledger along with any attached files. Use Reverse instead if the entry is a real adjustment you need to keep on record.`,
            )
          )
            return;
          setError(null);
          startTransition(async () => {
            const res = await deleteManualJournalEntryAction(entryId);
            if (!res.ok) {
              setError(res.error ?? 'Could not delete the entry.');
              return;
            }
            router.refresh();
          });
        }}
      >
        {pending ? 'Deleting…' : 'Delete'}
      </Button>
    </span>
  );
}
