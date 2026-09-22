'use client';

// "Cancel remaining & close": the supplier won't ship the rest of this
// PO. Confirms with the exact remainder being cancelled, then trims
// un-received quantities to what arrived, scales tax, and closes the PO
// — the remainder stops counting as committed cost everywhere.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cancelRemainingPoAction } from '../actions';

export function CancelRemainingButton({
  poId,
  remainingValue,
}: {
  poId: string;
  /** Un-received goods value (ordered − received, at unit cost). */
  remainingValue: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    const msg =
      remainingValue > 0.005
        ? `Cancel the un-received remainder of this PO ($${remainingValue.toFixed(2)} of goods, plus its share of tax) and close it?\n\nOrdered quantities are trimmed down to what actually arrived, and the PO stops counting as committed cost. This can't be undone from the UI.`
        : `Close this PO? Everything ordered was received — closing just tells the system nothing further is expected from the vendor.`;
    if (!confirm(msg)) return;
    startTransition(async () => {
      setError(null);
      const res = await cancelRemainingPoAction(poId);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={onClick}
        title="The supplier won't ship the rest — cancel the remainder and close the PO"
      >
        {pending
          ? 'Closing…'
          : remainingValue > 0.005
            ? 'Cancel remaining & close'
            : 'Close PO'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
