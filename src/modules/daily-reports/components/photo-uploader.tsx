'use client';

// Office-side photo uploader (desktop daily-report edit page). Downscales
// before upload and calls the action imperatively for the same reason as
// the field uploader: Vercel rejects request bodies over ~4.5MB BEFORE the
// server action runs, so a plain form action dies silently on full-size
// camera photos. See src/lib/images/downscale-photo.ts.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { downscalePhotoForUpload } from '@/lib/images/downscale-photo';
import { uploadPhotoAction } from '../actions';
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
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || !formRef.current) return;
    const fd = new FormData(formRef.current);
    const file = fd.get('photo');
    if (!(file instanceof File) || file.size === 0) {
      setFormError('Choose a photo to upload.');
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      fd.set('photo', await downscalePhotoForUpload(file));
      const result = await uploadPhotoAction(projectId, reportId, {}, fd);
      if (result.formError) {
        setFormError(result.formError);
      } else {
        formRef.current.reset();
        router.refresh();
      }
    } catch {
      setFormError(
        'Upload failed — the photo never reached the server. Check your connection and try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-4">
          <Label className="text-xs">Photo (JPG / PNG / WebP / HEIC, ≤ 10MB)</Label>
          <Input
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
      {formError && (
        <p className="text-xs text-red-600">{formError}</p>
      )}
    </form>
  );
}
