'use client';

import { useActionState, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  bulkCreateReceiptDraftsAction,
  type BulkImportActionState,
} from '../actions';

const ACCEPT =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif';

// Bulk uploader: pick N files → each becomes a draft receipt with the file
// attached. Sequential processing on the server keeps storage load
// predictable. After submit, shows a result row per file (link to receipt
// on success, error string on failure).
export function ReceiptBulkUploader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File[]>([]);
  const [state, action, pending] = useActionState<BulkImportActionState, FormData>(
    bulkCreateReceiptDraftsAction,
    {},
  );

  function onFilesChosen(list: FileList | null) {
    if (!list) return;
    setSelected(Array.from(list));
  }

  function clearSelection() {
    setSelected([]);
    if (inputRef.current) inputRef.current.value = '';
  }

  const okCount = state.results?.filter((r) => r.receiptId).length ?? 0;
  const failCount = state.results?.filter((r) => r.error).length ?? 0;

  return (
    <form action={action} className="space-y-4">
      <div className="rounded-md border-2 border-dashed border-slate-300 p-6 text-center space-y-2">
        <input
          ref={inputRef}
          type="file"
          name="file"
          multiple
          accept={ACCEPT}
          onChange={(e) => onFilesChosen(e.target.files)}
          className="block mx-auto text-sm"
        />
        <p className="text-xs text-slate-500">
          PDF, JPG, PNG, HEIC, WebP. Up to 25 MB per file. Each file becomes a
          draft receipt — fill in vendor / project / cost code afterwards.
        </p>
      </div>

      {selected.length > 0 && (
        <div className="rounded-md border border-slate-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700">
              {selected.length} file{selected.length === 1 ? '' : 's'} ready
            </span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-[11px] text-slate-500 hover:text-slate-900"
            >
              Clear
            </button>
          </div>
          <ul className="text-xs text-slate-600 space-y-1 max-h-40 overflow-auto">
            {selected.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex justify-between">
                <span className="truncate">{f.name}</span>
                <span className="font-mono tabular-nums text-slate-400">
                  {(f.size / 1024).toFixed(0)} KB
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || selected.length === 0}>
          {pending
            ? `Uploading ${selected.length}…`
            : selected.length === 0
              ? 'Pick files first'
              : `Create ${selected.length} draft${selected.length === 1 ? '' : 's'}`}
        </Button>
        {state.formError && (
          <p className="text-xs text-red-600">{state.formError}</p>
        )}
      </div>

      {state.results && state.results.length > 0 && (
        <div className="rounded-md border border-slate-200 p-3 space-y-2">
          <div className="text-xs font-medium text-slate-700">
            Results — {okCount} created, {failCount} failed
          </div>
          <ul className="text-xs space-y-1 max-h-60 overflow-auto">
            {state.results.map((r, i) => (
              <li
                key={`${r.fileName}-${i}`}
                className="flex justify-between gap-2 border-b border-slate-100 pb-1"
              >
                <span className="truncate">{r.fileName}</span>
                {r.receiptId ? (
                  <Link
                    href={{ pathname: `/banking/receipts/${r.receiptId}` }}
                    className="text-blue-700 hover:underline whitespace-nowrap"
                  >
                    Open draft →
                  </Link>
                ) : (
                  <span className="text-red-600 whitespace-nowrap">
                    {r.error ?? 'Failed.'}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {okCount > 0 && (
            <div className="pt-2">
              <Link
                href={{
                  pathname: '/banking/receipts',
                  query: { status: 'draft' },
                }}
                className="text-xs text-blue-700 hover:underline"
              >
                See all drafts →
              </Link>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
