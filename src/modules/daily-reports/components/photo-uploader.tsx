'use client';

import { useActionState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { uploadPhotoAction, type PhotoActionState } from '../actions';
import {
  photoCategoryValues,
  PHOTO_CATEGORY_LABEL,
} from '../schema';

export function PhotoUploader({
  projectId,
  reportId,
}: {
  projectId: string;
  reportId: string;
}) {
  const bound = uploadPhotoAction.bind(null, projectId, reportId);
  const [state, formAction, pending] = useActionState<PhotoActionState, FormData>(
    bound,
    {},
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Reset the form on a successful upload so the user can immediately add
  // another photo without leftover values from the previous upload.
  if (state.ok && formRef.current) {
    formRef.current.reset();
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-4">
          <Label className="text-xs">Photo (JPG / PNG / WebP / HEIC, ≤ 10MB)</Label>
          <Input
            ref={fileInputRef}
            type="file"
            name="photo"
            accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif"
            required
            className="bg-white"
          />
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">Caption (optional)</Label>
          <Input name="caption" placeholder="What is this photo?" className="bg-white" />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Category</Label>
          <Select name="category" defaultValue="progress" className="bg-white">
            {photoCategoryValues.map((c) => (
              <option key={c} value={c}>
                {PHOTO_CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </div>
        <div className="md:col-span-2 flex items-end">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              name="visibleToClient"
              defaultChecked
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>Visible to client</span>
          </label>
        </div>
        <div className="md:col-span-1 flex items-end">
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      </div>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
    </form>
  );
}
