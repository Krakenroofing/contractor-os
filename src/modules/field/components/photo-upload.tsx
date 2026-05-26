'use client';

// Field-side photo uploader. Two capture paths depending on runtime:
//
//   - In the Capacitor native shell (iOS/Android app): use
//     @capacitor/camera. Better photo quality, in-app preview, no
//     OS-level prompt loop after the first grant. Detected via
//     isCapacitorNative() at click time.
//   - In a regular phone browser: input[type=file capture=environment]
//     opens the OS camera as a fallback.
//
// Both paths land on the same uploadPhotoAction so server-side handling
// is identical. The component swaps the front-end primitive only.

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { isCapacitorNative } from '@/lib/capacitor/runtime';
import { captureNativePhoto } from '@/lib/capacitor/camera';
import type { PhotoActionState } from '@/modules/daily-reports/actions';

const initial: PhotoActionState = {};

type Action = (
  prev: PhotoActionState,
  formData: FormData,
) => Promise<PhotoActionState>;

export function FieldPhotoUpload({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setChosenName(file ? file.name : null);
    // Auto-submit so a single tap+capture posts the photo.
    if (file && formRef.current) {
      formRef.current.requestSubmit();
    }
  }

  /**
   * Native capture path. Open the OS camera via @capacitor/camera, get
   * back a File, stuff it into the hidden file input, and submit the
   * form — that way the server action sees exactly the same FormData
   * shape it gets from the browser fallback.
   *
   * DataTransfer is the standards-compliant way to programmatically
   * set a file input's value. Direct assignment to input.files is
   * read-only.
   */
  async function onNativeCameraTap() {
    setNativeError(null);
    try {
      const result = await captureNativePhoto();
      if (!result) return; // user cancelled
      if (!fileInputRef.current || !formRef.current) return;
      const dt = new DataTransfer();
      dt.items.add(result.file);
      fileInputRef.current.files = dt.files;
      setChosenName(result.file.name);
      formRef.current.requestSubmit();
    } catch (err) {
      setNativeError(
        err instanceof Error ? err.message : 'Camera failed to open.',
      );
    }
  }

  // After a successful upload, clear the chosen-name + reset the form
  // so the worker can take another photo without re-mounting the
  // component.
  if (state.ok && chosenName !== null) {
    setChosenName(null);
    formRef.current?.reset();
  }

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

      {/*
        Hidden file input. In native mode it's still here because we
        programmatically set its `.files` from the Capacitor camera
        result (via DataTransfer) before submit. In web mode it's the
        actual capture target via the <label> below.
      */}
      <input
        ref={fileInputRef}
        id="photoFile"
        name="photo"
        type="file"
        // capture="environment" hints to iOS/Android browsers to open
        // the rear-facing camera directly. Ignored when the native
        // path is in use.
        accept="image/*"
        capture="environment"
        onChange={onFileChange}
        className="sr-only"
      />

      {native ? (
        // Native path — explicit button, not a label, because we don't
        // want the OS file picker to open. The handler talks to
        // @capacitor/camera directly.
        <button
          type="button"
          onClick={onNativeCameraTap}
          disabled={pending}
          className={
            'flex items-center justify-center w-full h-14 rounded-md text-base font-semibold ' +
            (pending
              ? 'bg-slate-200 text-slate-500'
              : 'bg-blue-600 hover:bg-blue-700 text-white')
          }
        >
          {pending
            ? 'Uploading…'
            : chosenName
              ? `Uploading ${chosenName}…`
              : '📷 Take photo'}
        </button>
      ) : (
        // Web path — <label> for the hidden file input lets the OS
        // open its camera picker on tap.
        <Label
          htmlFor="photoFile"
          className={
            'flex items-center justify-center w-full h-14 rounded-md text-base font-semibold cursor-pointer ' +
            (pending
              ? 'bg-slate-200 text-slate-500'
              : 'bg-blue-600 hover:bg-blue-700 text-white')
          }
        >
          {pending
            ? 'Uploading…'
            : chosenName
              ? `Uploading ${chosenName}…`
              : '📷 Add photo'}
        </Label>
      )}

      {/* Hidden visibility toggle so the form layer has it even when
          unchecked. Defaults to true (client sees these by default). */}
      <input type="hidden" name="visibleToClient" value="on" />

      <p className="text-[11px] text-slate-500 text-center">
        {native
          ? 'Opens the native camera. New photo will upload immediately.'
          : 'Tap to open camera. Pick from gallery via the OS prompt.'}
      </p>

      {/* Hidden submit so requestSubmit() above triggers the action. */}
      <Button type="submit" className="hidden" disabled={pending}>
        Upload
      </Button>
    </form>
  );
}
