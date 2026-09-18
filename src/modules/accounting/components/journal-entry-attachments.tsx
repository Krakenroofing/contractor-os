'use client';

// Attachments block on a MANUAL journal entry card: existing files as
// image-thumbnail / file-chip links, plus a "📎 Attach files" picker that
// uploads direct-to-storage (signed URLs — same pipeline as team notes) and
// records the refs. Keeps the working papers next to the adjustment.

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteJournalEntryAttachmentAction } from '../gl-actions';
import { uploadJournalAttachments } from '../lib/journal-attachment-upload';

export type JournalAttachmentView = {
  id: string;
  originalFileName: string;
  mimeType: string;
  /** Signed inline URL (server-generated) for image thumbnails; null when
   *  storage is unavailable. Non-images always use the download route. */
  viewUrl: string | null;
};

export function JournalEntryAttachments({
  entryId,
  attachments,
  canEdit,
}: {
  entryId: string;
  attachments: JournalAttachmentView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function pickFiles() {
    fileInputRef.current?.click();
  }

  function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list).slice(0, 10);
    setError(null);
    startTransition(async () => {
      const problems = await uploadJournalAttachments(entryId, files);
      if (problems.length > 0) setError(problems.join(' '));
      if (fileInputRef.current) fileInputRef.current.value = '';
      router.refresh();
    });
  }

  function removeAttachment(id: string, name: string) {
    if (!window.confirm(`Remove "${name}" from this entry?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteJournalEntryAttachmentAction(id);
      if (!res.ok) setError(res.error ?? 'Could not remove the file.');
      router.refresh();
    });
  }

  if (attachments.length === 0 && !canEdit) return null;

  return (
    <div className="border-t border-slate-100 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        {attachments.map((a) => {
          const isImage = a.mimeType.startsWith('image/');
          const href = `/accounting/journal/attachments/${a.id}/download${isImage ? '?view=1' : ''}`;
          return (
            <span key={a.id} className="group relative inline-flex">
              {isImage && a.viewUrl ? (
                <a href={href} target="_blank" rel="noreferrer" title={a.originalFileName}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.viewUrl}
                    alt={a.originalFileName}
                    className="h-14 w-14 rounded border border-slate-200 object-cover bg-white"
                  />
                </a>
              ) : (
                <a
                  href={href}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  title={a.originalFileName}
                >
                  📎 <span className="max-w-40 truncate">{a.originalFileName}</span>
                </a>
              )}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${a.originalFileName}`}
                  onClick={() => removeAttachment(a.id, a.originalFileName)}
                  className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-[10px] leading-none text-white group-hover:flex"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        {canEdit && (
          <>
            <button
              type="button"
              onClick={pickFiles}
              disabled={busy}
              className="rounded border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {busy ? 'Uploading…' : '📎 Attach files'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
            />
          </>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
