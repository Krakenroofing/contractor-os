'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { directUploadFiles } from '@/lib/storage/direct-upload-client';
import {
  createLandedCostUploadUrlsAction,
  uploadLandedCostDocumentsAction,
  deleteLandedCostAttachmentAction,
} from '../document-actions';

export type ShippingDocRow = {
  id: string;
  originalFileName: string;
  byteSize: number;
  uploadedAt: string;
};

const ACCEPT =
  'application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,image/*';

function fmtBytes(b: number): string {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// Two-click delete: first click arms ("Click again"), second confirms.
function DeleteDocButton({
  onConfirm,
  disabled,
}: {
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      size="sm"
      variant={armed ? 'destructive' : 'outline'}
      disabled={disabled}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          setTimeout(() => setArmed(false), 4000);
        } else {
          onConfirm();
        }
      }}
    >
      {armed ? 'Click again' : 'Delete'}
    </Button>
  );
}

export function ShippingDocuments({
  landedCostId,
  documents,
  allowEdit,
}: {
  landedCostId: string;
  documents: ShippingDocRow[];
  allowEdit: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('file') as HTMLInputElement | null;
    const files = Array.from(input?.files ?? []);
    if (files.length === 0) {
      setError('Choose at least one file to upload.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const outcome = await directUploadFiles({
        files,
        requestUrls: (reqs) => createLandedCostUploadUrlsAction(landedCostId, reqs),
      });
      if (outcome.formError) {
        setError(outcome.formError);
        return;
      }
      let finalizeError: string | undefined;
      if (outcome.refs.length > 0) {
        const fd = new FormData();
        fd.set('uploads', JSON.stringify(outcome.refs));
        const r = await uploadLandedCostDocumentsAction(landedCostId, {}, fd);
        finalizeError = r.formError;
      }
      const problems = [...(finalizeError ? [finalizeError] : []), ...outcome.failures];
      if (problems.length > 0) {
        setError(problems.join(' · '));
      } else {
        formRef.current?.reset();
        router.refresh();
      }
    } catch {
      setError('Upload failed — the files never reached the server. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      {documents.length === 0 ? (
        <p className="text-sm text-slate-500">
          No shipping documents attached yet.
          {allowEdit && ' Add the broker/Tropical invoice, SAD, or bill of lading below.'}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">
                  {d.originalFileName}
                </div>
                <div className="text-xs text-slate-500">
                  {fmtBytes(d.byteSize)} · {new Date(d.uploadedAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={`/landed-cost/${landedCostId}/documents/${d.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="sm" variant="outline">
                    Download
                  </Button>
                </a>
                {allowEdit && (
                  <DeleteDocButton
                    disabled={deleting}
                    onConfirm={() =>
                      startDelete(async () => {
                        const r = await deleteLandedCostAttachmentAction(landedCostId, d.id);
                        if (r.formError) setError(r.formError);
                        else router.refresh();
                      })
                    }
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {allowEdit && (
        <form
          ref={formRef}
          onSubmit={onSubmit}
          className="flex flex-col gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 sm:flex-row sm:items-center"
        >
          <Input
            type="file"
            name="file"
            multiple
            accept={ACCEPT}
            className="bg-white"
          />
          <Button type="submit" disabled={pending} className="shrink-0">
            {pending ? 'Uploading…' : 'Upload'}
          </Button>
        </form>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-[11px] text-slate-400">PDF · Excel · CSV · images, ≤ 100MB each.</p>
    </div>
  );
}
