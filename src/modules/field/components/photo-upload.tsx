'use client';

// Field-side photo uploader. Two sources (camera / gallery) across two
// runtimes:
//
//   - In the Capacitor native shell (iOS/Android app): use
//     @capacitor/camera with source 'camera' or 'photos'. Better quality,
//     in-app preview, no OS-level prompt loop after the first grant.
//   - In a regular phone browser: a hidden file input per source — one with
//     capture="environment" (opens the camera) and one without (opens the
//     gallery / file picker).
//
// BATCHING: the crew rarely has just one photo. Instead of uploading the
// instant a photo is picked, picks accumulate in a staging queue — take
// several shots one after another, multi-select a whole batch from the
// gallery, then press Upload once. Each queued file is still downscaled
// client-side (Vercel rejects bodies over ~4.5MB BEFORE the server action
// runs — see downscale-photo.ts) and uploaded via a direct action call so
// transport failures surface as a visible error instead of dying silently.
// That silent death is exactly how weeks of field photos went missing: the
// worker saw the spinner stop and assumed "saved". Photos that fail stay in
// the queue so the worker can retry just those once signal returns.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { isCapacitorNative } from '@/lib/capacitor/runtime';
import {
  captureNativePhoto,
  pickNativePhotos,
  type NativePhotoSource,
} from '@/lib/capacitor/camera';
import { downscalePhotoForUpload } from '@/lib/images/downscale-photo';
import type { PhotoActionState } from '@/modules/daily-reports/actions';

type Action = (
  prev: PhotoActionState,
  formData: FormData,
) => Promise<PhotoActionState>;

type QueuedPhoto = {
  id: number;
  file: File;
  /** Object URL for the thumbnail preview; revoked when removed/uploaded. */
  url: string;
  /** Set when a prior upload attempt failed, so the worker sees which ones. */
  error?: string;
};

export function FieldPhotoUpload({ action }: { action: Action }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const idCounter = useRef(0);
  const [queue, setQueue] = useState<QueuedPhoto[]>([]);
  const [pending, setPending] = useState(false);
  // While uploading the batch: how many are done out of how many total.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  // How many uploaded successfully on the last run (for the success banner).
  const [uploadedCount, setUploadedCount] = useState(0);
  // Capacitor detection has to happen after mount — window.Capacitor is
  // populated by the native bridge before the bundle executes, but
  // server-render can't know that. Default to "web" until we confirm.
  const [native, setNative] = useState(false);

  useEffect(() => {
    setNative(isCapacitorNative());
  }, []);

  // Revoke any outstanding preview URLs when the component unmounts. A ref
  // mirror avoids re-running this on every queue change.
  const queueRef = useRef<QueuedPhoto[]>([]);
  queueRef.current = queue;
  useEffect(() => {
    return () => {
      for (const item of queueRef.current) URL.revokeObjectURL(item.url);
    };
  }, []);

  // Add picked files to the staging queue (does NOT upload yet).
  function enqueueFiles(files: File[]) {
    if (files.length === 0) return;
    setUploadedCount(0);
    setFormError(null);
    setQueue((q) => [
      ...q,
      ...files.map((file) => ({
        id: (idCounter.current += 1),
        file,
        url: URL.createObjectURL(file),
      })),
    ]);
  }

  function removeFromQueue(id: number) {
    setQueue((q) => {
      const item = q.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return q.filter((p) => p.id !== id);
    });
  }

  // Upload the whole queue, one file per action call (the action takes a
  // single 'photo'). Sequential — keeps memory low on phones and lets each
  // file carry the shared category/caption from the form. Succeeded photos
  // leave the queue; failed ones stay (flagged) for a one-tap retry.
  async function uploadQueue() {
    if (pending || queue.length === 0) return;
    setPending(true);
    setFormError(null);
    setUploadedCount(0);

    const items = [...queue];
    const stillQueued: QueuedPhoto[] = [];
    let success = 0;

    for (let i = 0; i < items.length; i++) {
      setProgress({ done: i, total: items.length });
      const item = items[i];
      try {
        const upload = await downscalePhotoForUpload(item.file);
        const fd = formRef.current
          ? new FormData(formRef.current)
          : new FormData();
        fd.set('photo', upload);
        const result = await action({}, fd);
        if (result.formError) {
          stillQueued.push({ ...item, error: result.formError });
        } else {
          success += 1;
          URL.revokeObjectURL(item.url);
        }
      } catch {
        stillQueued.push({
          ...item,
          error: 'Never reached the server — check signal and retry.',
        });
      }
    }

    setProgress(null);
    setQueue(stillQueued);
    setUploadedCount(success);
    setPending(false);

    if (stillQueued.length > 0) {
      setFormError(
        `${stillQueued.length} photo${stillQueued.length === 1 ? '' : 's'} didn't upload. Check your signal and tap Upload to retry just ${stillQueued.length === 1 ? 'it' : 'those'}.`,
      );
    }
    if (success > 0) {
      // The gallery above this uploader is server-rendered — refresh so the
      // new photos appear immediately as proof they saved.
      router.refresh();
    }
  }

  function onCameraChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = ''; // Reset so picking the same file again still fires.
    enqueueFiles(files);
  }

  function onGalleryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    enqueueFiles(files);
  }

  // Native single-shot camera: take one photo, add it to the queue. Tap
  // again for the next shot.
  async function onNativeCamera(source: NativePhotoSource) {
    setFormError(null);
    try {
      const result = await captureNativePhoto(source);
      if (!result) return; // user cancelled
      enqueueFiles([result.file]);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Could not open the camera.',
      );
    }
  }

  // Native gallery: multi-select straight from the OS picker.
  async function onNativeGallery() {
    setFormError(null);
    try {
      const results = await pickNativePhotos();
      if (results.length === 0) return; // cancelled / none picked
      enqueueFiles(results.map((r) => r.file));
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Could not open the gallery.',
      );
    }
  }

  const uploadLabel = progress
    ? `Uploading ${progress.done + 1} of ${progress.total}…`
    : 'Uploading…';

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-3">
      {formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {formError}
        </div>
      )}
      {uploadedCount > 0 && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
          ✓ {uploadedCount} photo{uploadedCount === 1 ? '' : 's'} uploaded.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="photoCategory" className="text-xs">
            Category
          </Label>
          <Select name="category" id="photoCategory" defaultValue="progress">
            <option value="progress">Progress</option>
            <option value="safety">Safety</option>
            <option value="issue">Issue</option>
            <option value="delivery">Delivery</option>
            <option value="inspection">Inspection</option>
            <option value="weather">Weather</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="photoCaption" className="text-xs">
            Caption
          </Label>
          <Input
            id="photoCaption"
            name="caption"
            placeholder="Optional"
            maxLength={500}
            className="text-base md:text-sm h-12 md:h-10"
          />
        </div>
      </div>

      {/* Web trigger inputs (one per source). Nameless so they never end up
          in the FormData; their files go through enqueueFiles directly.
          Gallery allows multi-select; camera shoots one at a time. */}
      {!native && (
        <>
          <input
            id="photoCamera"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onCameraChange}
            className="sr-only"
          />
          <input
            id="photoGallery"
            type="file"
            accept="image/*"
            multiple
            onChange={onGalleryChange}
            className="sr-only"
          />
        </>
      )}

      {/* Add-photo buttons. Always available (even mid-queue) unless an
          upload is in flight. */}
      {!pending &&
        (native ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onNativeCamera('camera')}
              className="flex items-center justify-center h-14 rounded-md text-base font-semibold bg-blue-600 hover:bg-blue-700 text-white"
            >
              📷 Take photo
            </button>
            <button
              type="button"
              onClick={onNativeGallery}
              className="flex items-center justify-center h-14 rounded-md text-base font-semibold border border-blue-600 text-blue-700 hover:bg-blue-50"
            >
              🖼️ Gallery
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Label
              htmlFor="photoCamera"
              className="flex items-center justify-center h-14 rounded-md text-base font-semibold cursor-pointer bg-blue-600 hover:bg-blue-700 text-white"
            >
              📷 Take photo
            </Label>
            <Label
              htmlFor="photoGallery"
              className="flex items-center justify-center h-14 rounded-md text-base font-semibold cursor-pointer border border-blue-600 text-blue-700 hover:bg-blue-50"
            >
              🖼️ Gallery
            </Label>
          </div>
        ))}

      {/* Staging queue: thumbnails of everything picked but not yet uploaded. */}
      {queue.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600">
            {queue.length} photo{queue.length === 1 ? '' : 's'} ready to upload
          </p>
          <div className="grid grid-cols-3 gap-2">
            {queue.map((item) => (
              <div
                key={item.id}
                className={`relative aspect-square overflow-hidden rounded-md border ${
                  item.error ? 'border-red-400' : 'border-slate-200'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt=""
                  className="h-full w-full object-cover"
                />
                {item.error && (
                  <div className="absolute inset-x-0 bottom-0 bg-red-600/85 px-1 py-0.5 text-[9px] leading-tight text-white">
                    Failed — will retry
                  </div>
                )}
                {!pending && (
                  <button
                    type="button"
                    onClick={() => removeFromQueue(item.id)}
                    aria-label="Remove photo"
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-sm font-bold text-white"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload control. */}
      {pending ? (
        <div className="flex items-center justify-center w-full h-14 rounded-md text-base font-semibold bg-slate-200 text-slate-500">
          {uploadLabel}
        </div>
      ) : (
        queue.length > 0 && (
          <button
            type="button"
            onClick={uploadQueue}
            className="flex items-center justify-center w-full h-14 rounded-md text-base font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            ⬆️ Upload {queue.length} photo{queue.length === 1 ? '' : 's'}
          </button>
        )
      )}

      {/* Defaults to true (client sees these photos by default). */}
      <input type="hidden" name="visibleToClient" value="on" />

      <p className="text-[11px] text-slate-500 text-center">
        Add as many photos as you need — take several shots or pick a batch
        from your gallery — then tap Upload once. Wait for the green
        &quot;uploaded&quot; check before closing the app.
      </p>
    </form>
  );
}
