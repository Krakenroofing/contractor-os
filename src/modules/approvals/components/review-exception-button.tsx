'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { reviewControlExceptionAction } from '../actions';

export function ReviewExceptionButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await reviewControlExceptionAction({ id });
            if (!res.ok) setError(res.error ?? 'Could not mark reviewed.');
            router.refresh();
          })
        }
      >
        Mark reviewed
      </Button>
    </span>
  );
}
