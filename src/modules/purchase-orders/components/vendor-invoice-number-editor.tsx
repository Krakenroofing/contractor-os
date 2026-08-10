'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setVendorInvoiceNumberAction } from '../actions';

/** Inline editor for the supplier's own invoice number on a PO. Works in
 *  any status — the vendor's bill arrives long after the PO is issued, so
 *  this stays editable when the rest of the header is locked. */
export function VendorInvoiceNumberEditor({
  poId,
  value,
}: {
  poId: string;
  value: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setVendorInvoiceNumberAction({
        id: poId,
        vendorInvoiceNumber: draft,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not save the invoice number.');
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        {value ? (
          <span className="font-mono text-xs text-slate-700">{value}</span>
        ) : (
          <span className="text-xs text-slate-400">none on file</span>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(value ?? '');
            setError(null);
            setEditing(true);
          }}
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
          aria-label="Edit vendor invoice number"
        >
          ✎ {value ? 'Edit' : 'Add invoice #'}
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            }
            if (e.key === 'Escape') setEditing(false);
          }}
          autoFocus
          placeholder="e.g. 2007834111-001"
          className="h-7 w-48 font-mono text-xs"
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
