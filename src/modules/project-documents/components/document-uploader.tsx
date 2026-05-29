'use client';

import { useActionState, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
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

// Two-form pattern:
//
//   Quick photo capture (mobile-first): a small form whose file input uses
//   `capture="environment"` to open the rear camera directly. Picks one photo,
//   submits immediately with category=photo, internal-only by default. Field
//   users can then edit the row to add a caption or toggle client-visible.
//
//   Detailed upload: the main form — multi-file, category/description/
//   visibility set by the operator. Stacks on phones, grids on desktop.
export function DocumentUploader({ projectId }: { projectId: string }) {
  const bound = uploadDocumentsAction.bind(null, projectId);

  // Detailed-upload form state
  const [state, formAction, pending] = useActionState<DocumentActionState, FormData>(
    bound,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [category, setCategory] = useState<DocumentCategory>('other');
  // Tracks whether the user has manually overridden the category — once they
  // do, we stop auto-suggesting 'photo' for image-only selections.
  const categoryTouchedRef = useRef(false);

  // Quick photo capture (separate form, separate action state)
  const [quickState, quickAction, quickPending] = useActionState<
    DocumentActionState,
    FormData
  >(bound, {});

  // Reset both forms after a successful submission so the next batch starts
  // clean. Resetting also clears the file inputs.
  if (state.ok && !state.formError && formRef.current) {
    formRef.current.reset();
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
      <form
        action={quickAction}
        className="rounded-md border border-slate-200 bg-white p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3"
      >
        <div className="flex-1 text-sm">
          <div className="font-medium text-slate-900">Quick photo capture</div>
          <div className="text-xs text-slate-500">
            One tap to take a site photo. Defaults to Photos / internal.
            Edit the row afterwards to add a caption.
          </div>
        </div>
        <input type="hidden" name="category" value="photo" />
        <input type="hidden" name="description" value="" />
        {/* visibleToClient deliberately omitted = false / internal */}
        <label
          className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 text-white text-sm font-medium px-4 h-11 sm:h-10 cursor-pointer hover:bg-slate-800 disabled:opacity-50 w-full sm:w-auto"
          aria-disabled={quickPending}
        >
          {quickPending ? 'Uploading…' : '📷 Take photo'}
          <input
            type="file"
            name="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={quickPending}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                e.target.form?.requestSubmit();
              }
            }}
          />
        </label>
      </form>
      {quickState.formError && (
        <p className="text-xs text-red-600 px-1">{quickState.formError}</p>
      )}
      {quickState.ok && !quickState.formError && (
        <p className="text-xs text-emerald-700 px-1">Photo uploaded.</p>
      )}

      {/* Detailed upload — stacks on mobile, grids on desktop. */}
      <form
        ref={formRef}
        action={formAction}
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
