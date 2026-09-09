'use client';

// Field-side photo manager for one of the crew member's own work orders —
// add shots they forgot at submission (or took after cleanup), while the
// office hasn't posted the call yet. Same downscale + per-photo upload
// pipeline as the submission form.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { downscalePhotoForUpload } from '@/lib/images/downscale-photo';
import {
  deleteWorkOrderPhotoAction,
  uploadWorkOrderPhotoAction,
} from '../actions';

export function FieldWorkOrderPhotos({
  workOrderId,
  photos,
  editable,
}: {
  workOrderId: string;
  photos: Array<{ id: string; url: string | null; caption: string | null }>;
  /** True while the WO is still 'submitted' (office hasn't posted it). */
  editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(files: File[]) {
    setError(null);
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      setBusy(`Uploading photo ${i + 1} of ${files.length}…`);
      try {
        const fd = new FormData();
        fd.set('photo', await downscalePhotoForUpload(files[i]));
        const res = await uploadWorkOrderPhotoAction(workOrderId, fd);
        if (!res.ok) failed += 1;
      } catch {
        failed += 1;
      }
    }
    setBusy(null);
    if (failed > 0) {
      setError(
        `${failed} photo${failed === 1 ? '' : 's'} failed to upload — check your connection and try again.`,
      );
    }
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-900">Job photos</p>
      {photos.length === 0 && (
        <p className="text-xs text-slate-500">No photos yet.</p>
      )}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <div
              key={p.id}
              className="relative rounded-md border border-slate-200 overflow-hidden bg-slate-50"
            >
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={p.caption ?? 'Job photo'}
                    className="h-24 w-full object-cover"
                  />
                </a>
              ) : (
                <div className="flex h-24 items-center justify-center text-[10px] text-slate-400">
                  unavailable
                </div>
              )}
              {editable && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={async () => {
                    if (!window.confirm('Delete this photo?')) return;
                    setBusy('Deleting…');
                    const res = await deleteWorkOrderPhotoAction(p.id);
                    setBusy(null);
                    if (!res.ok) setError(res.error ?? 'Delete failed.');
                    router.refresh();
                  }}
                  className="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 text-sm text-slate-600 shadow"
                  aria-label="Delete photo"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {editable ? (
        <label className="block">
          <span className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50">
            📷 {busy ?? 'Add photos'}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif"
            multiple
            className="hidden"
            disabled={busy !== null}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length > 0) void addFiles(files);
            }}
          />
        </label>
      ) : (
        <p className="text-[11px] text-slate-500">
          The office has already processed this call — ask them to add any
          extra photos.
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </section>
  );
}
