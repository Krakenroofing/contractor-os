'use client';

// Posted journal entries are final — Reverse is the correction path. The
// reversal lands on the original date while that month is open (else
// today); "Reverse & correct" then opens a new entry pre-filled with the
// original lines to fix and post.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { reverseJournalEntryAction } from '../gl-actions';

export function ReverseEntryButton({
  entryId,
  allowCorrect = false,
}: {
  entryId: string;
  /** Manual entries only: offer "Reverse & correct". */
  allowCorrect?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(correct: boolean) {
    if (
      !window.confirm(
        correct
          ? 'Reverse this entry and post a corrected one?\n\nThe original and its reversal both stay on record; a new entry opens pre-filled with the original lines for you to fix.'
          : 'Reverse this entry?\n\nA mirror entry cancels it out. Both stay on record.',
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await reverseJournalEntryAction({ entryId });
      if (!res.ok) {
        setError(res.error ?? 'Could not reverse the entry.');
        return;
      }
      if (correct) {
        router.push(`/accounting/journal/new?correctionOf=${entryId}` as never);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      {allowCorrect && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(true)}
        >
          {pending ? 'Working…' : 'Reverse & correct'}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => run(false)}
      >
        {pending ? 'Reversing…' : 'Reverse'}
      </Button>
    </span>
  );
}
