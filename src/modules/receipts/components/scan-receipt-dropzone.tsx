'use client';

// Drag-and-drop scan-to-create for the New receipt page. Drop (or pick) a
// receipt photo / PDF: it uploads straight to storage, a draft receipt is
// created WITH the attachment, and — when OCR is configured — the vendor,
// date, total, and VAT arrive prefilled. Then we navigate to the draft for
// review. One step instead of create-then-attach.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { directUploadFiles } from '@/lib/storage/direct-upload-client';
import {
  createReceiptFromScanAction,
  createReceiptUploadUrlsAction,
} from '../actions';

const ACCEPT =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif';

type Phase = 'idle' | 'uploading' | 'scanning' | 'opening';

export function ScanReceiptDropzone({ ocrEnabled }: { ocrEnabled: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== 'idle';

  async function handleFile(file: File) {
    if (busy) return;
    setError(null);
    setPhase('uploading');
    try {
      const outcome = await directUploadFiles({
        files: [file],
        requestUrls: createReceiptUploadUrlsAction,
      });
      if (outcome.formError || outcome.refs.length === 0) {
        setError(
          outcome.formError ??
            outcome.failures[0] ??
            'Upload failed — try again.',
        );
        setPhase('idle');
        return;
      }
      setPhase('scanning');
      const result = await createReceiptFromScanAction({
        ref: outcome.refs[0],
      });
      if (!result.ok) {
        setError(result.error);
        setPhase('idle');
        return;
      }
      setPhase('opening');
      router.push(`/banking/receipts/${result.receiptId}` as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setPhase('idle');
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a receipt photo or PDF"
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-colors select-none ${
          dragOver
            ? 'border-emerald-500 bg-emerald-50'
            : busy
              ? 'border-slate-200 bg-slate-50 cursor-wait'
              : 'border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-white'
        }`}
      >
        {phase === 'idle' && (
          <>
            <p className="text-sm font-medium text-slate-900">
              📷 Drop a receipt photo or PDF here
            </p>
            <p className="text-xs text-slate-500 mt-1">
              …or click to choose a file. The image is attached to the receipt
              {ocrEnabled
                ? ' and scanned — vendor, date, total, and VAT prefill automatically.'
                : ' automatically. (Scanning is off — OCR is not configured for this deployment.)'}
            </p>
          </>
        )}
        {phase === 'uploading' && (
          <p className="text-sm text-slate-700">Uploading…</p>
        )}
        {phase === 'scanning' && (
          <p className="text-sm text-slate-700">
            {ocrEnabled ? 'Scanning the receipt…' : 'Creating the receipt…'}
          </p>
        )}
        {phase === 'opening' && (
          <p className="text-sm text-emerald-700">
            Done — opening the draft…
          </p>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-slate-400">
        Scanning several receipts at once? Use{' '}
        <a href="/banking/receipts/bulk" className="underline">
          bulk upload
        </a>
        . Prefer typing it in? Use the form below — you can still attach the
        image after saving.
      </p>
    </div>
  );
}
