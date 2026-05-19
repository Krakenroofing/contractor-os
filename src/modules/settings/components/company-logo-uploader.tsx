'use client';

import { useActionState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  uploadCompanyLogoAction,
  removeCompanyLogoAction,
  type CompanyLogoActionState,
} from '../actions';

export function CompanyLogoUploader({
  companyName,
  currentLogoUrl,
}: {
  companyName: string;
  /** Signed URL for the current logo (already minted server-side), or null. */
  currentLogoUrl: string | null;
}) {
  const [uploadState, uploadAction, uploadPending] = useActionState<
    CompanyLogoActionState,
    FormData
  >(uploadCompanyLogoAction, {});
  const [, removeAction] = useActionState<CompanyLogoActionState, FormData>(
    removeCompanyLogoAction,
    {},
  );
  const uploadFormRef = useRef<HTMLFormElement>(null);

  if (uploadState.ok && !uploadState.formError && uploadFormRef.current) {
    uploadFormRef.current.reset();
  }

  const initials = companyName
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {currentLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentLogoUrl}
            alt={`${companyName} logo`}
            className="h-14 max-w-[140px] object-contain bg-white border border-slate-200 rounded p-1"
          />
        ) : (
          <div className="h-14 w-14 rounded-md bg-slate-900 text-white flex items-center justify-center text-sm font-semibold">
            {initials}
          </div>
        )}
        <div className="text-xs text-slate-500">
          {currentLogoUrl
            ? 'Active logo. Upload a new image to replace it.'
            : 'No logo set — initials are used as a fallback on every branded document.'}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
        <form
          ref={uploadFormRef}
          action={uploadAction}
          className="flex flex-wrap items-end gap-3 flex-1 min-w-[220px]"
        >
          <div className="flex-1 min-w-[220px]">
            <Label className="text-xs">
              Upload logo (PNG or JPG only, ≤ 5 MB)
            </Label>
            <Input
              type="file"
              name="logo"
              // PNG/JPG only — @react-pdf/renderer can't embed SVG, WebP, GIF,
              // or AVIF into generated PDFs. Those formats render fine on
              // screen but silently disappear from every invoice / proposal /
              // PO / CO PDF the system downloads.
              accept="image/png,image/jpeg,image/jpg"
              required
              className="bg-white"
            />
          </div>
          <Button type="submit" disabled={uploadPending}>
            {uploadPending ? 'Uploading…' : currentLogoUrl ? 'Replace logo' : 'Upload logo'}
          </Button>
        </form>
        {currentLogoUrl && (
          <form action={removeAction}>
            <ConfirmButton
              size="md"
              variant="outline"
              confirmLabel="Click again"
              pendingLabel="Removing…"
            >
              Remove
            </ConfirmButton>
          </form>
        )}
      </div>

      {uploadState.formError && (
        <p className="text-xs text-red-600">{uploadState.formError}</p>
      )}
      {uploadState.ok && !uploadState.formError && (
        <p className="text-xs text-emerald-700">Logo updated.</p>
      )}
    </div>
  );
}
