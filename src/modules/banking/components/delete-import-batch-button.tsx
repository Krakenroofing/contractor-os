'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { deleteImportBatchAction } from '../actions';

/**
 * Inline delete button for a statement import batch. Click → native confirm →
 * server action. The cascade on FKs handles the transactions + match cleanup
 * for us. After success, refreshes the current route so the Recent imports
 * list (or batch detail page) re-renders.
 *
 * Pass `redirectOnSuccess` to navigate elsewhere after delete — e.g. the
 * detail page sends the user back to /banking once the batch they were
 * viewing no longer exists.
 */
export function DeleteImportBatchButton({
  batchId,
  filename,
  rowCount,
  redirectOnSuccess,
}: {
  batchId: string;
  filename: string;
  rowCount: number | null;
  redirectOnSuccess?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    const rows = rowCount && rowCount > 0 ? ` (${rowCount} row${rowCount === 1 ? '' : 's'})` : '';
    if (
      !confirm(
        `Delete "${filename}"${rows}?\n\nThis also removes every transaction imported from this file and any matches against them. Matched invoices/receipts will revert to "unmatched" but are not deleted.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteImportBatchAction({ batchId });
      if (!res.ok) {
        setError(res.error ?? 'Delete failed.');
        return;
      }
      if (redirectOnSuccess) {
        router.push(redirectOnSuccess as never);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={onClick}
        disabled={pending}
        className="text-red-600 hover:text-red-700"
      >
        {pending ? 'Deleting…' : 'Delete'}
      </Button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}
