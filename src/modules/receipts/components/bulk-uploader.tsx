'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import { directUploadFiles } from '@/lib/storage/direct-upload-client';
import {
  bulkCreateReceiptDraftsAction,
  bulkExtractMultiReceiptPdfAction,
  createReceiptUploadUrlsAction,
  type BulkImportActionState,
  type BulkPdfExtractActionState,
} from '../actions';
import { ocrIsEnabledAction } from '../ocr-actions';

const ACCEPT =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif';

/**
 * Two modes share the same form:
 *
 *  - "files"        — many files; each file → one draft. No OCR.
 *  - "split-pdf"    — one PDF; each page → one draft + OCR-extracted vendor /
 *                     date / total. Only available when exactly one PDF is
 *                     selected.
 *
 * Submitting uploads the files directly to storage (signed URLs), then
 * routes the path refs to the matching server action; results render per
 * mode from locally-managed state.
 */
const ACCEPT_EXT = /\.(pdf|jpe?g|png|webp|heic|heif|gif)$/i;

function isAcceptedFile(f: File): boolean {
  return ACCEPT.split(',').includes(f.type.toLowerCase()) || ACCEPT_EXT.test(f.name);
}

export function ReceiptBulkUploader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File[]>([]);
  const [splitMode, setSplitMode] = useState(false);
  const [ocrEnabled, setOcrEnabled] = useState<boolean | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Files upload DIRECTLY to storage (signed URLs — no ~4.5MB transport
  // cap), then the bulk action gets path refs to verify + record. Action
  // results are managed manually so transport failures surface as errors
  // instead of dying silently.
  const [filesState, setFilesState] = useState<BulkImportActionState>({});
  const [pdfState, setPdfState] = useState<BulkPdfExtractActionState>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ocrIsEnabledAction().then((on) => {
      if (!cancelled) setOcrEnabled(on);
    });
    return () => {
      cancelled = false;
    };
  }, []);

  const singlePdf =
    selected.length === 1 && selected[0].type === 'application/pdf';
  const splitAvailable = singlePdf;
  // If the user had split-mode on but then changed the selection so
  // it's no longer eligible, fall back to files mode.
  const effectiveSplitMode = splitMode && splitAvailable;

  // Both the browse dialog and drag-drop APPEND to the current selection so
  // a batch can be gathered from several folders. Duplicates (same name +
  // size) are skipped.
  function addFiles(files: File[]) {
    const accepted = files.filter(isAcceptedFile);
    if (accepted.length === 0) return;
    setSelected((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}`));
      return [...prev, ...accepted.filter((f) => !seen.has(`${f.name}|${f.size}`))];
    });
  }

  function onFilesChosen(list: FileList | null) {
    if (!list) return;
    addFiles(Array.from(list));
    // Reset so re-picking the same file fires onChange again.
    if (inputRef.current) inputRef.current.value = '';
  }

  function clearSelection() {
    setSelected([]);
    setSplitMode(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || selected.length === 0) return;
    setPending(true);
    setFilesState({});
    setPdfState({});
    const setError = (msg: string) =>
      effectiveSplitMode
        ? setPdfState({ formError: msg })
        : setFilesState({ formError: msg });
    try {
      const outcome = await directUploadFiles({
        files: selected,
        requestUrls: createReceiptUploadUrlsAction,
      });
      if (outcome.formError) {
        setError(outcome.formError);
        return;
      }
      if (outcome.refs.length === 0) {
        setError(outcome.failures.join(' / ') || 'Nothing was uploaded.');
        return;
      }
      const fd = new FormData();
      fd.set('uploads', JSON.stringify(outcome.refs));
      if (effectiveSplitMode) {
        const result = await bulkExtractMultiReceiptPdfAction({}, fd);
        setPdfState(result);
      } else {
        const result = await bulkCreateReceiptDraftsAction({}, fd);
        // Surface per-file upload failures alongside the action's results.
        if (outcome.failures.length > 0) {
          result.formError = [result.formError, ...outcome.failures]
            .filter(Boolean)
            .join(' / ');
        }
        setFilesState(result);
      }
      clearSelection();
    } catch {
      setError(
        'Upload failed — the files never reached the server. Check your connection and try again.',
      );
    } finally {
      setPending(false);
    }
  }

  const submitDisabled = pending || selected.length === 0;

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-4">

        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            addFiles(Array.from(e.dataTransfer.files ?? []));
          }}
          className={`rounded-md border-2 border-dashed p-6 text-center space-y-2 cursor-pointer transition-colors ${
            dragActive
              ? 'border-blue-400 bg-blue-50'
              : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            name="file"
            multiple={!effectiveSplitMode}
            accept={ACCEPT}
            onChange={(e) => onFilesChosen(e.target.files)}
            className="sr-only"
            tabIndex={-1}
          />
          <p className="text-sm font-medium text-slate-700">
            {dragActive
              ? 'Drop the files…'
              : 'Drag & drop receipt photos / PDFs here — or click to browse'}
          </p>
          <p className="text-xs text-slate-500">
            PDF, JPG, PNG, HEIC, WebP. Up to 25 MB per file. Each file becomes a
            draft receipt — fill in vendor / project / cost code afterwards.
            Pick more than once to add to the batch.
          </p>
        </div>

        {splitAvailable && (
          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={splitMode}
              onChange={(e) => setSplitMode(e.target.checked)}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <div className="font-medium text-slate-900">
                This PDF contains multiple receipts — split by page
              </div>
              <p className="text-xs text-slate-500">
                Each page becomes its own draft receipt. The page is saved
                as the attachment.{' '}
                {ocrEnabled === false ? (
                  <span className="text-amber-700">
                    OCR is not configured — drafts will be created but the
                    vendor / date / total will be blank.
                  </span>
                ) : ocrEnabled === true ? (
                  <span className="text-emerald-700">
                    OCR is configured — vendor, date, and total will be
                    auto-extracted on each page.
                  </span>
                ) : (
                  <span>Checking OCR configuration…</span>
                )}{' '}
                Max 25 pages per upload.
              </p>
            </div>
          </label>
        )}

        {selected.length > 0 && (
          <div className="rounded-md border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">
                {effectiveSplitMode
                  ? `1 PDF (split mode)`
                  : `${selected.length} file${selected.length === 1 ? '' : 's'} ready`}
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
          <Button type="submit" disabled={submitDisabled}>
            {pending
              ? effectiveSplitMode
                ? 'Splitting + scanning…'
                : `Uploading ${selected.length}…`
              : selected.length === 0
                ? 'Pick files first'
                : effectiveSplitMode
                  ? 'Split PDF + create drafts'
                  : `Create ${selected.length} draft${selected.length === 1 ? '' : 's'}`}
          </Button>
          {(filesState.formError || pdfState.formError) && (
            <p className="text-xs text-red-600">
              {filesState.formError ?? pdfState.formError}
            </p>
          )}
        </div>
      </form>

      {/* File-mode results */}
      {filesState.results && filesState.results.length > 0 && (
        <ResultsCard
          headline={`Results — ${filesState.results.filter((r) => r.receiptId).length} created, ${filesState.results.filter((r) => r.error).length} failed`}
        >
          <ul className="text-xs space-y-1 max-h-60 overflow-auto">
            {filesState.results.map((r, i) => (
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
        </ResultsCard>
      )}

      {/* PDF split-mode results */}
      {pdfState.results && pdfState.results.length > 0 && (
        <ResultsCard
          headline={`Split ${pdfState.pageCount ?? pdfState.results.length} page(s) — ${pdfState.results.filter((r) => r.receiptId).length} drafts created, ${pdfState.results.filter((r) => r.error).length} failed`}
        >
          {pdfState.ocrEnabled === false && (
            <p className="text-[11px] text-amber-700 mb-1">
              OCR was not configured for this run — drafts have blank vendor
              / total fields. Use the per-draft &ldquo;Auto-fill&rdquo;
              button after configuring Google Document AI.
            </p>
          )}
          <ul className="text-xs space-y-1 max-h-72 overflow-auto">
            {pdfState.results.map((r) => (
              <li
                key={r.pageNumber}
                className="grid grid-cols-[60px_1fr_auto] gap-2 border-b border-slate-100 pb-1 items-center"
              >
                <span className="font-mono text-slate-500">
                  pg {r.pageNumber}
                </span>
                <span className="truncate text-slate-700">
                  {r.vendorName ? (
                    <>
                      <strong className="text-slate-900">
                        {r.vendorName}
                      </strong>
                      {r.receiptDate && (
                        <span className="ml-2 text-slate-500">
                          {r.receiptDate}
                        </span>
                      )}
                      {r.total !== undefined && (
                        <span className="ml-2 tabular-nums text-slate-700">
                          {formatMoney(r.total)}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-500">
                      {r.error ?? 'Created (no extraction)'}
                    </span>
                  )}
                </span>
                {r.receiptId ? (
                  <Link
                    href={{ pathname: `/banking/receipts/${r.receiptId}` }}
                    className="text-blue-700 hover:underline whitespace-nowrap"
                  >
                    Open →
                  </Link>
                ) : (
                  <span className="text-red-600 whitespace-nowrap">
                    failed
                  </span>
                )}
              </li>
            ))}
          </ul>
        </ResultsCard>
      )}
    </div>
  );
}

function ResultsCard({
  headline,
  children,
}: {
  headline: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-slate-200 p-3 space-y-2">
      <div className="text-xs font-medium text-slate-700">{headline}</div>
      {children}
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
    </div>
  );
}
