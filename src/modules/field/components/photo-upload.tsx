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
// Whichever source the worker picks, the chosen File is copied into a single
// hidden "carrier" input (name="photo") and the form is submitted, so the
// server action sees one identical FormData shape in every case.

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { isCapacitorNative } from '@/lib/capacitor/runtime';
import {
  captureNativePhoto,
  type NativePhotoSource,
} from '@/lib/capacitor/camera';
import type { PhotoActionState } from '@/modules/daily-reports/actions';

const initial: PhotoActionState = {};

type Action = (
  prev: PhotoActionState,
  formData: FormData,
) => Promise<PhotoActionState>;

export function FieldPhotoUpload({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, initial);
  const formRef = useRef<HTMLFormElement>(null);
  // The single input that actually submits (name="photo"). Trigger inputs
  // below copy their chosen file into this one before submit.
  const carrierRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  // Show the chosen filename so the worker can see something selected
  // before submission, then clear when the upload completes.
  const [chosenName, setChosenName] = useState<string | null>(null);
  // Capacitor detection has to happen after mount — window.Capacitor is
  // populated by the native bridge before the bundle executes, but
  // server-render can't know that. Default to "web" until we confirm.
  const [native, setNative] = useState(false);
  const [nativeError, setNativeError] = useState<string | null>(null);

  useEffect(() => {
    setNative(isCapacitorNative());
  }, []);

  // Copy a chosen File into the carrier input and submit. DataTransfer is
  // the standards-compliant way to set a file input's value (direct
  // assignment to input.files is read-only).
  function submitFile(file: File) {
    if (!carrierRef.current || !formRef.current) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    carrierRef.current.files = dt.files;
    setChosenName(file.name);
    formRef.current.requestSubmit();
  }

  function onTriggerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the trigger so picking the SAME file again still fires change.
    e.target.value = '';
    if (file) submitFile(file);
  }

  // Native capture path. Open the OS camera or gallery via
  // @capacitor/camera, get back a File, and submit through the carrier.
  async function onNativeTap(source: NativePhotoSource) {
    setNativeError(null);
    try {
      const result = await captureNativePhoto(source);
      if (!result) return; // user cancelled
      submitFile(result.file);
    } catch (err) {
      setNativeError(
        err instanceof Error ? err.message : 'Could not open the photo picker.',
      );
    }
  }

  // After a successful upload, clear the chosen-name + reset the form
  // so the worker can add another photo without re-mounting the component.
  if (state.ok && chosenName !== null) {
    setChosenName(null);
    formRef.current?.reset();
  }

  const busyLabel = chosenName ? `Uploading ${chosenName}…` : 'Uploading…';

  return (
    <form
      ref={formRef}
      action={formAction}
      // multipart needed because the photo is a real File blob; without
      // enctype Next would serialise to RSC action format which can't
      // ship raw bytes.
      encType="multipart/form-data"
      className="space-y-3"
    >
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {state.formError}
        </div>
      )}
      {state.ok && (
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

      {nativeError && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          {nativeError}
        </div>
      )}

      {/* The carrier input that actually submits. Never opened directly. */}
      <input ref={carrierRef} name="photo" type="file" accept="image/*" className="sr-only" />

      {/* Web trigger inputs (one per source). Nameless so they don't submit;
          their file is copied into the carrier above. */}
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
        Take a new photo or upload one from your gallery — it uploads right away.
      </p>
    </form>
  );
}
