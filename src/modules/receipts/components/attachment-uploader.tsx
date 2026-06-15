'use client';

// Receipt attachment uploader. Files go DIRECTLY to Supabase Storage via
// signed upload URLs (bypassing the ~4.5MB Vercel action body cap that
// silently killed large uploads), then a finalize action verifies each
// blob and records the attachment. Images are downscaled client-side
// first — a 6MB phone photo becomes ~0.5MB, so camera captures upload
// fast even on cell signal.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { directUploadFiles } from '@/lib/storage/direct-upload-client';
import {
  createReceiptUploadUrlsAction,
  uploadReceiptAttachmentAction,
} from '../actions';

const ACCEPT =
  'application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,image/gif';

export function ReceiptAttachmentUploader({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function uploadFiles(files: File[]) {
    if (pending || files.length === 0) return;
    setPending(true);
    setFormError(null);
    setOk(false);
    try {
      const outcome = await directUploadFiles({
        files,
        requestUrls: createReceiptUploadUrlsAction,
      });
      if (outcome.formError) {
        setFormError(outcome.formError);
        return;
      }
      let finalizeError: string | undefined;
      if (outcome.refs.length > 0) {
        const fd = new FormData();
        fd.set('uploads', JSON.stringify(outcome.refs));
        const result = await uploadReceiptAttachmentAction(receiptId, {}, fd);
        finalizeError = result.formError;
      }
      const problems = [
        ...(finalizeError ? [finalizeError] : []),
        ...outcome.failures,
      ];
      if (problems.length > 0) {
        setFormError(problems.join(' / '));
      } else {
        setOk(true);
        formRef.current?.reset();
        router.refresh();
      }
    } catch {
      setFormError(
        'Upload failed — the files never reached the server. Check your connection and try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Quick photo capture — mobile-friendly. */}
      <div className="rounded-md border border-slate-200 bg-white p-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 text-sm">
          <div className="font-medium text-slate-900">Quick photo</div>
          <div className="text-xs text-slate-500">
            One tap to take a photo of the receipt.
          </div>
        </div>
        <label className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 text-white text-sm font-medium px-4 h-11 sm:h-10 cursor-pointer hover:bg-slate-800 disabled:opacity-50 w-full sm:w-auto">
          {pending ? 'Uploading…' : '📷 Take photo'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={pending}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void uploadFiles(files);
            }}
          />
        </label>
      </div>

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem(
            'file',
          ) as HTMLInputElement | null;
          void uploadFiles(Array.from(input?.files ?? []));
        }}
        className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 space-y-3"
      >
        <div>
          <Label>Attach files (PDF or image, ≤ 25 MB each)</Label>
          <Input
            type="file"
            name="file"
            multiple
            accept={ACCEPT}
            className="bg-white"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            JPG · PNG · HEIC · WEBP · PDF
          </p>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Uploading…' : 'Upload'}
        </Button>
        {formError && <p className="text-xs text-red-600">{formError}</p>}
        {ok && !formError && (
          <p className="text-xs text-emerald-700">Uploaded.</p>
        )}
      </form>
    </div>
  );
}
