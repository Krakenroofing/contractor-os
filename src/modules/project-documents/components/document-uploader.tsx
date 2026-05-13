'use client';

import { useActionState, useRef } from 'react';
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
} from '../schema';

// Mirrors the daily-report PhotoUploader pattern. Multi-file upload via the
// native <input multiple> — drag-and-drop is Phase 3.
export function DocumentUploader({ projectId }: { projectId: string }) {
  const bound = uploadDocumentsAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState<DocumentActionState, FormData>(
    bound,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Reset on success so a clean form is ready for the next batch.
  if (state.ok && !state.formError && formRef.current) {
    formRef.current.reset();
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-5">
          <Label className="text-xs">Files (multi-select, ≤ 100MB each)</Label>
          <Input
            type="file"
            name="file"
            multiple
            required
            className="bg-white"
            // Accept hint — browsers may still allow others; server enforces.
            accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,image/*,application/zip,.dwg,.dxf"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            PDF · DOCX · XLSX · CSV · images (JPG/PNG/HEIC) · DWG · DXF · ZIP
          </p>
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">Category</Label>
          <Select name="category" defaultValue="other" className="bg-white">
            {documentCategoryValues.map((c) => (
              <option key={c} value={c}>
                {DOCUMENT_CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Description (optional)</Label>
          <Input
            name="description"
            placeholder="Notes about this file"
            className="bg-white"
          />
        </div>
        <div className="md:col-span-1 flex items-end">
          <label className="flex items-center gap-2 cursor-pointer text-xs">
            <input
              type="checkbox"
              name="visibleToClient"
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>Client&nbsp;visible</span>
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
      {state.ok && !state.formError && (
        <p className="text-xs text-emerald-700">Uploaded successfully.</p>
      )}
    </form>
  );
}
