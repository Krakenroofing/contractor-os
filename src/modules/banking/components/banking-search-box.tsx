'use client';

// GET-form search box for /banking/search. Plain form navigation — no
// client state to manage; the results page is server-rendered from ?q=.

import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function BankingSearchBox({
  initialQuery = '',
  autoFocus = false,
}: {
  initialQuery?: string;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <form
      action="/banking/search"
      method="GET"
      className="flex items-center gap-2 max-w-xl"
    >
      <Input
        ref={inputRef}
        name="q"
        defaultValue={initialQuery}
        autoFocus={autoFocus}
        placeholder="Search descriptions, vendors, refs, amounts (e.g. 1,500 or kelly)…"
        aria-label="Search banking and receipts"
      />
      <Button type="submit">Search</Button>
    </form>
  );
}
