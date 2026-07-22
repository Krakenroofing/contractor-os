'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { renamePurchaseOrderAction } from '../actions';

/** Inline rename for the PO number on the detail page. Works in any status —
 *  the number is cosmetic (all links are by id) — so a typo like PO012 can
 *  become PO0012 even after the PO is issued. */
export function RenamePoNumber({
  poId,
  number,
}: {
  poId: string;
  number: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(number);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await renamePurchaseOrderAction({ id: poId, number: value });
      if (!res.ok) {
        setError(res.error ?? 'Could not rename the PO.');
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-xs text-slate-500">{number}</span>
        <button
          type="button"
          onClick={() => {
            setValue(number);
            setError(null);
            setEditing(true);
          }}
          className="text-xs text-slate-400 hover:text-slate-600"
          aria-label="Rename PO number"
          title="Rename PO number"
        >
          ✎
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1.5">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            }
            if (e.key === 'Escape') setEditing(false);
          }}
          autoFocus
          className="h-7 w-40 font-mono text-xs"
        />
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </span>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
