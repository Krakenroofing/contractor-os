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
// Whichever source the worker picks, the File is downscaled client-side
// (Vercel rejects bodies over ~4.5MB BEFORE the server action runs — see
// downscale-photo.ts) and the action is invoked imperatively so transport
// failures surface as a visible error instead of dying silently. That
// silent death is exactly how weeks of field photos went missing: the
// worker saw the spinner stop and assumed "saved".

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { isCapacitorNative } from '@/lib/capacitor/runtime';
import {
  captureNativePhoto,
  type NativePhotoSource,
} from '@/lib/capacitor/camera';
import { downscalePhotoForUpload } from '@/lib/images/downscale-photo';
import type { PhotoActionState } from '@/modules/daily-reports/actions';

type Action = (
  prev: PhotoActionState,
  formData: FormData,
) => Promise<PhotoActionState>;

export function FieldPhotoUpload({ action }: { action: Action }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  // Show the chosen filename so the worker can see something selected
  // before submission, then clear when the upload completes.
  const [chosenName, setChosenName] = useState<string | null>(null);
  // Capacitor detection has to happen after mount — window.Capacitor is
  // populated by the native bridge before the bundle executes, but
  // server-render can't know that. Default to "web" until we confirm.
  const [native, setNative] = useState(false);

  useEffect(() => {
    setNative(isCapacitorNative());
  }, []);

  // Downscale + upload via a direct action call (NOT a form action). A
  // form action that fails in transit (413 at the platform edge, dropped
  // cell signal) never updates state, so the worker gets zero feedback.
  // Awaiting the action ourselves lets us catch transport failures and
  // show a retry message.
  async function submitFile(file: File) {
    if (pending) return;
    setPending(true);
    setFormError(null);
    setOk(false);
    setChosenName(file.name);
    try {
      const upload = await downscalePhotoForUpload(file);
      const fd = formRef.current
        ? new FormData(formRef.current)
        : new FormData();
      fd.set('photo', upload);
      const result = await action({}, fd);
      if (result.formError) {
        setFormError(result.formError);
      } else {
        setOk(true);
        setChosenName(null);
        formRef.current?.reset();
        // The gallery above this uploader is server-rendered — refresh so
        // the new photo appears immediately as proof it saved.
        router.refresh();
      }
    } catch {
      setFormError(
        'Upload failed — the photo never reached the server. Check your signal and tap the button to try again.',
      );
    } finally {
      setPending(false);
    }
  }

  function onTriggerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the trigger so picking the SAME file again still fires change.
    e.target.value = '';
    if (file) void submitFile(file);
  }

  // Native capture path. Open the OS camera or gallery via
  // @capacitor/camera, get back a File, and upload it.
  async function onNativeTap(source: NativePhotoSource) {
    setFormError(null);
    try {
      const result = await captureNativePhoto(source);
      if (!result) return; // user cancelled
      await submitFile(result.file);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Could not open the photo picker.',
      );
    }
  }

  const busyLabel = chosenName ? `Uploading ${chosenName}…` : 'Uploading…';

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-3">
      {formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {formError}
        </div>
      )}
      {ok && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
          ✓ Photo uploaded.
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
          in the FormData; their file goes through submitFile directly. */}
      {!native && (
        <>
          <input
            ref={cameraInputRef}
            id="photoCamera"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onTriggerChange}
            className="sr-only"
          />
          <input
            ref={galleryInputRef}
            id="photoGallery"
            type="file"
            accept="image/*"
            onChange={onTriggerChange}
            className="sr-only"
          />
        </>
      )}

      {pending ? (
        <div className="flex items-center justify-center w-full h-14 rounded-md text-base font-semibold bg-slate-200 text-slate-500">
          {busyLabel}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {native ? (
            <>
              <button
                type="button"
                onClick={() => onNativeTap('camera')}
                className="flex items-center justify-center h-14 rounded-md text-base font-semibold bg-blue-600 hover:bg-blue-700 text-white"
              >
                📷 Take photo
              </button>
              <button
                type="button"
                onClick={() => onNativeTap('photos')}
                className="flex items-center justify-center h-14 rounded-md text-base font-semibold border border-blue-600 text-blue-700 hover:bg-blue-50"
              >
                🖼️ Gallery
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      {/* Defaults to true (client sees these photos by default). */}
      <input type="hidden" name="visibleToClient" value="on" />

      <p className="text-[11px] text-slate-500 text-center">
        Take a new photo or upload one from your gallery — it uploads right
        away. Wait for the green &quot;Photo uploaded&quot; check before
        closing the app.
      </p>
    </form>
  );
}
