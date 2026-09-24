'use client';

// Field receipt capture (Chris, 2026-09-24): the crew photographs a paper
// receipt and it lands as a DRAFT receipt in the office queue for Olga to
// code and assign — same pipeline as the office scan dropzone (signed
// direct upload + createReceiptFromScanAction, so OCR prefills vendor /
// date / total when configured). The worker never sees the banking side;
// they just get a loud per-photo confirmation here.

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { directUploadFiles } from '@/lib/storage/direct-upload-client';
import {
  createReceiptFromScanAction,
  createReceiptUploadUrlsAction,
} from '@/modules/receipts/actions';

const ACCEPT =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif';

type UploadRow = {
  key: string;
  fileName: string;
  status: 'uploading' | 'done' | 'error';
  summary?: string;
  error?: string;
};

export function ReceiptSnap() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);

  function patchRow(key: string, patch: Partial<UploadRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleFiles(files: File[]) {
    if (files.length === 0 || busy) return;
    setBusy(true);
    const currentNote = note.trim();
    try {
      // Sequential, one receipt per file — jobsite connections choke on
      // parallel uploads, and per-file results read clearly either way.
      for (const file of files) {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setRows((prev) => [
          { key, fileName: file.name || 'photo', status: 'uploading' },
          ...prev,
        ]);
        try {
          const outcome = await directUploadFiles({
            files: [file],
            requestUrls: createReceiptUploadUrlsAction,
          });
          if (outcome.formError || outcome.refs.length === 0) {
            patchRow(key, {
              status: 'error',
              error:
                outcome.formError ??
                outcome.failures[0] ??
                'Upload failed — check your signal and try again.',
            });
            continue;
          }
          const result = await createReceiptFromScanAction({
            ref: outcome.refs[0],
            note: currentNote || undefined,
          });
          if (!result.ok) {
            patchRow(key, { status: 'error', error: result.error });
            continue;
          }
          const bits: string[] = [];
          if (result.vendorName) bits.push(result.vendorName);
          if (result.total !== undefined && result.total > 0)
            bits.push(`$${result.total.toFixed(2)}`);
          patchRow(key, {
            status: 'done',
            summary:
              bits.length > 0 ? bits.join(' · ') : 'Sent to the office to code',
          });
        } catch (err) {
          patchRow(key, {
            status: 'error',
            error:
              err instanceof Error
                ? err.message
                : 'Upload failed — check your signal and try again.',
          });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    void handleFiles(files);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="receipt-note" className="text-xs">
          What&apos;s it for? (optional — helps the office code it)
        </Label>
        <Input
          id="receipt-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="e.g. Danny's house — screws and caulking"
          className="text-base md:text-sm h-12 md:h-10"
        />
      </div>

      <div className="grid grid-cols-1 gap-2">
        <Button
          type="button"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
          className="w-full h-16 text-lg font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {busy ? 'Uploading…' : '📷 Take a photo of the receipt'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => filesRef.current?.click()}
          className="w-full h-12"
        >
          Choose from gallery / files
        </Button>
      </div>

      {/* capture="environment" opens the rear camera directly on phones;
          the second input picks existing photos or PDFs, several at once. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
      />
      <input
        ref={filesRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={onPick}
      />

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.key}
              className={
                'rounded-lg border px-4 py-3 text-sm ' +
                (r.status === 'done'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : r.status === 'error'
                    ? 'border-red-200 bg-red-50 text-red-800'
                    : 'border-slate-200 bg-white text-slate-700')
              }
            >
              {r.status === 'uploading' && <>Uploading {r.fileName}…</>}
              {r.status === 'done' && (
                <>
                  ✓ Receipt uploaded
                  {r.summary ? ` — ${r.summary}` : ''}
                </>
              )}
              {r.status === 'error' && (
                <>
                  ✗ {r.fileName}: {r.error}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
