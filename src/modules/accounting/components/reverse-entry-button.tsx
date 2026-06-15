'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { reverseJournalEntryAction } from '../gl-actions';

export function ReverseEntryButton({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await reverseJournalEntryAction({
            entryId,
            entryDate: new Date().toISOString().slice(0, 10),
          });
          router.refresh();
        })
      }
    >
      {pending ? 'Reversing…' : 'Reverse'}
    </Button>
  );
}
