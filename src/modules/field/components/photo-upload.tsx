'use client';

// Field-side photo uploader. Wraps uploadPhotoAction (pre-bound on the
// server with projectId + reportId) with a phone-friendly UI:
//
//   - input[type=file capture=environment] triggers the rear camera
//     directly on iOS/Android (rather than a generic file picker).
//   - Upload kicks off automatically on file selection — no "submit"
//     button. Workers are usually one-handed on a roof; tap-tap-done.
//   - The file input is hidden; a styled <label> serves as the visible
//     button so we can size it for thumbs.
//
// Phase M5 (Capacitor wrapper) will swap this for the native Camera
// plugin, which yields better quality and lets us downsize before
// upload. For browser/PWA users it's the right primitive.

import { useActionState, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { PhotoActionState } from '@/modules/daily-reports/actions';

const initial: PhotoActionState = {};

type Action = (
  prev: PhotoActionState,
  formData: FormData,
) => Promise<PhotoActionState>;

export function FieldPhotoUpload({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, initial);
  const formRef = useRef<HTMLFormElement>(null);
  // Show the chosen filename so the worker can see something selected
  // before submission, then clear when the upload completes.
  const [chosenName, setChosenName] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setChosenName(file ? file.name : null);
    // Auto-submit so a single tap+capture posts the photo.
    if (file && formRef.current) {
      formRef.current.requestSubmit();
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

      {/* Hidden file input — the <label> below is the visible target. */}
      <input
        id="photoFile"
        name="photo"
        type="file"
        // capture="environment" hints to iOS/Android to open the
        // rear-facing camera. Falls back to gallery if user denies or
        // taps "Choose from library" in the OS-level prompt.
        accept="image/*"
        capture="environment"
        onChange={onFileChange}
        className="sr-only"
      />

      <Label
        htmlFor="photoFile"
        // Visible button. role=button + tabIndex make it keyboard-
        // navigable as well; the actual focus + Enter behavior is on
        // the hidden input. Sized 14h for thumb tap.
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

      {/* Hidden visibility toggle so the form layer has it even when
          unchecked. Defaults to true (client sees these by default). */}
      <input type="hidden" name="visibleToClient" value="on" />

      {/* Tiny escape hatch for non-camera flows — opens the OS gallery
          picker explicitly. Useful when the worker already took a
          photo in their phone's camera app. */}
      <p className="text-[11px] text-slate-500 text-center">
        Tap to open camera. Pick from gallery via the OS prompt.
      </p>

      {/* Hidden submit so requestSubmit() above triggers the action. */}
      <Button type="submit" className="hidden" disabled={pending}>
        Upload
      </Button>
    </form>
  );
}
