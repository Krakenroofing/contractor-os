'use client';

import { useActionState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  uploadReceiptAttachmentAction,
  type ReceiptActionState,
} from '../actions';

const ACCEPT =
  'application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,image/gif';

export function ReceiptAttachmentUploader({ receiptId }: { receiptId: string }) {
  const bound = uploadReceiptAttachmentAction.bind(null, receiptId);
  const [state, action, pending] = useActionState<ReceiptActionState, FormData>(
    bound,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  if (state.ok && !state.formError && formRef.current) {
    formRef.current.reset();
  }
  return (
    <div className="space-y-3">
      {/* Quick photo capture — mobile-friendly. */}
      <form
        action={action}
        className="rounded-md border border-slate-200 bg-white p-3 flex flex-col sm:flex-row sm:items-center gap-3"
      >
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
            name="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={pending}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                e.target.form?.requestSubmit();
              }
            }}
          />
        </label>
      </form>

      <form
        ref={formRef}
        action={action}
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
        {state.formError && (
          <p className="text-xs text-red-600">{state.formError}</p>
        )}
        {state.ok && !state.formError && (
          <p className="text-xs text-emerald-700">Uploaded.</p>
        )}
      </form>
    </div>
  );
}
