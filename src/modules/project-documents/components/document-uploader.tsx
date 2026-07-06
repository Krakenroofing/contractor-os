'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { directUploadFiles } from '@/lib/storage/direct-upload-client';
import {
  createDocumentUploadUrlsAction,
  uploadDocumentsAction,
  type DocumentActionState,
} from '../actions';
import {
  documentCategoryValues,
  DOCUMENT_CATEGORY_LABEL,
  type DocumentCategory,
} from '../schema';

// File picker MIME hint. Browsers may still allow others; server enforces.
const FILE_ACCEPT =
  'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,image/*,application/zip,.dwg,.dxf';

// Files go DIRECTLY to Supabase Storage via signed upload URLs (the old
// form-action path silently capped every upload at ~4.5MB — Vercel's
// request body limit — despite the "≤100MB" label). Images are downscaled
// client-side before upload; documents ship as-is up to 100MB.
//
// Two-form pattern:
//
//   Quick photo capture (mobile-first): a small form whose file input uses
//   `capture="environment"` to open the rear camera directly. Picks one photo,
//   uploads immediately with category=photo, internal-only by default. Field
//   users can then edit the row to add a caption or toggle client-visible.
//
//   Detailed upload: the main form — multi-file, category/description/
//   visibility set by the operator. Stacks on phones, grids on desktop.
export function DocumentUploader({
  projectId,
  defaultCategory,
}: {
  projectId: string;
  // Pre-selects the category dropdown — set from a `?category=` param when the
  // user arrives via a section's "Upload" link (e.g. Change Orders → change_order).
  defaultCategory?: DocumentCategory;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [category, setCategory] = useState<DocumentCategory>(
    defaultCategory ?? 'other',
  );
  // Tracks whether the user has manually overridden the category — once they
  // do, we stop auto-suggesting 'photo' for image-only selections. A category
  // arriving via link counts as an explicit choice, so we don't clobber it.
  const categoryTouchedRef = useRef(defaultCategory != null);

  const [state, setState] = useState<DocumentActionState>({});
  const [pending, setPending] = useState(false);
  const [quickState, setQuickState] = useState<DocumentActionState>({});
  const [quickPending, setQuickPending] = useState(false);

  async function uploadBatch(opts: {
    files: File[];
    meta: { category: string; description: string; visibleToClient: boolean };
    setBatchState: (s: DocumentActionState) => void;
    setBatchPending: (p: boolean) => void;
    onSuccess?: () => void;
  }) {
    if (opts.files.length === 0) {
      opts.setBatchState({ formError: 'Choose at least one file to upload.' });
      return;
    }
    opts.setBatchPending(true);
    opts.setBatchState({});
    try {
      const outcome = await directUploadFiles({
        files: opts.files,
        requestUrls: (reqs) => createDocumentUploadUrlsAction(projectId, reqs),
      });
      if (outcome.formError) {
        opts.setBatchState({ formError: outcome.formError });
        return;
      }
      let finalizeError: string | undefined;
      if (outcome.refs.length > 0) {
        const fd = new FormData();
        fd.set('uploads', JSON.stringify(outcome.refs));
        fd.set('category', opts.meta.category);
        fd.set('description', opts.meta.description);
        if (opts.meta.visibleToClient) fd.set('visibleToClient', 'on');
        const result = await uploadDocumentsAction(projectId, {}, fd);
        finalizeError = result.formError;
      }
      const problems = [
        ...(finalizeError ? [finalizeError] : []),
        ...outcome.failures,
      ];
      if (problems.length > 0) {
        opts.setBatchState({ formError: problems.join(' / ') });
      } else {
        opts.setBatchState({ ok: true });
        opts.onSuccess?.();
        router.refresh();
      }
    } catch {
      opts.setBatchState({
        formError:
          'Upload failed — the files never reached the server. Check your connection and try again.',
      });
    } finally {
      opts.setBatchPending(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || categoryTouchedRef.current) return;
    // Auto-suggest 'photo' when every selected file is an image.
    let allImages = true;
    for (let i = 0; i < files.length; i++) {
      if (!files[i].type.startsWith('image/')) {
        allImages = false;
        break;
      }
    }
    if (allImages) setCategory('photo');
  }

  return (
    <div className="space-y-3">
      {/* Quick photo capture — most prominent on phones, useful on desktop too. */}
      <div className="rounded-md border border-slate-200 bg-white p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 text-sm">
          <div className="font-medium text-slate-900">Quick photo capture</div>
          <div className="text-xs text-slate-500">
            One tap to take a site photo. Defaults to Photos / internal.
            Edit the row afterwards to add a caption.
          </div>
        </div>
        {/* visibleToClient deliberately false = internal */}
        <label
          className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 text-white text-sm font-medium px-4 h-11 sm:h-10 cursor-pointer hover:bg-slate-800 disabled:opacity-50 w-full sm:w-auto"
          aria-disabled={quickPending}
        >
          {quickPending ? 'Uploading…' : '📷 Take photo'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={quickPending}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void uploadBatch({
                files,
                meta: { category: 'photo', description: '', visibleToClient: false },
                setBatchState: setQuickState,
                setBatchPending: setQuickPending,
              });
            }}
          />
        </label>
      </div>
      {quickState.formError && (
        <p className="text-xs text-red-600 px-1">{quickState.formError}</p>
      )}
      {quickState.ok && !quickState.formError && (
        <p className="text-xs text-emerald-700 px-1">Photo uploaded.</p>
      )}

      {/* Detailed upload — stacks on mobile, grids on desktop. */}
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const input = form.elements.namedItem('file') as HTMLInputElement | null;
          const description =
            (form.elements.namedItem('description') as HTMLInputElement | null)
              ?.value ?? '';
          void uploadBatch({
            files: Array.from(input?.files ?? []),
            meta: { category, description, visibleToClient: false },
            setBatchState: setState,
            setBatchPending: setPending,
            onSuccess: () => formRef.current?.reset(),
          });
        }}
        className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 space-y-3"
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5">
            <Label className="text-sm md:text-xs">
              Files (multi-select, ≤ 100MB each)
            </Label>
            <Input
              type="file"
              name="file"
              multiple
              required
              className="bg-white h-11 md:h-10"
              accept={FILE_ACCEPT}
              onChange={handleFileChange}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              PDF · DOCX · XLSX · CSV · images (JPG/PNG/HEIC) · DWG · DXF · ZIP
            </p>
          </div>
          <div className="md:col-span-3">
            <Label className="text-sm md:text-xs">Category</Label>
            <Select
              name="category"
              value={category}
              onChange={(e) => {
                categoryTouchedRef.current = true;
                setCategory(e.target.value as DocumentCategory);
              }}
              className="bg-white h-11 md:h-10"
            >
              {documentCategoryValues.map((c) => (
                <option key={c} value={c}>
                  {DOCUMENT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label className="text-sm md:text-xs">Description (optional)</Label>
            <Input
              name="description"
              placeholder="Notes about this file"
              className="bg-white h-11 md:h-10"
            />
          </div>
          {/* "Client visible" control hidden until a client-facing portal /
              share surface exists — the flag gates nothing today, so exposing
              it would mislead owners into thinking a doc is shared. Uploads
              default to internal (visibleToClient = false). */}
          <div className="md:col-span-1 flex items-end">
            <Button
              type="submit"
              disabled={pending}
              size="lg"
              className="w-full md:h-10 md:text-sm md:px-4"
            >
              {pending ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </div>
        {state.formError && (
          <p className="text-xs text-red-600">{state.formError}</p>
        )}
        {state.ok && !state.formError && (
          <p className="text-xs text-emerald-700">Uploaded successfully.</p>
        )}
      </form>
    </div>
  );
}
