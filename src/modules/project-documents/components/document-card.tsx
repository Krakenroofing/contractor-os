'use client';

import { useActionState, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  updateDocumentAction,
  deleteDocumentAction,
  type DocumentActionState,
} from '../actions';
import {
  documentCategoryValues,
  DOCUMENT_CATEGORY_LABEL,
} from '../schema';
import { canPreviewInline } from '../lib/preview';
import type { DocumentRowData } from './document-row';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Mobile card layout for a single document. Used at <md breakpoints; on
// desktop, DocumentRow takes over (rendered inside a table). Both components
// own their own useActionState — this is fine because only one is visible per
// viewport so only one set of forms can ever be interacted with.
export function DocumentCard({
  projectId,
  document,
  allowEdit,
}: {
  projectId: string;
  document: DocumentRowData;
  allowEdit: boolean;
}) {
  const updateBound = updateDocumentAction.bind(null, projectId, document.id);
  const deleteBound = deleteDocumentAction.bind(null, projectId, document.id);
  const [updateState, updateAction, updatePending] = useActionState<
    DocumentActionState,
    FormData
  >(updateBound, {});
  const [, deleteAction] = useActionState<DocumentActionState, FormData>(
    deleteBound,
    {},
  );

  const [editing, setEditing] = useState(false);
  const previewable = canPreviewInline(document.mimeType);
  const uploadedDate = new Date(document.uploadedAt).toLocaleString();

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      {editing && allowEdit ? (
        <form action={updateAction} className="space-y-3">
          <div>
            <Label className="text-xs">File name</Label>
            <Input
              name="fileName"
              defaultValue={document.fileName}
              required
              className="h-11"
            />
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <Select
              name="category"
              defaultValue={document.category}
              className="h-11"
            >
              {documentCategoryValues.map((c) => (
                <option key={c} value={c}>
                  {DOCUMENT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Input
              name="description"
              defaultValue={document.description ?? ''}
              placeholder="optional"
              className="h-11"
            />
          </div>
          {/* "Visible to client" control hidden until a client portal exists
              (the flag gates nothing today). Preserve the stored value so an
              edit can't silently flip it. */}
          <input
            type="hidden"
            name="visibleToClient"
            value={document.visibleToClient ? 'on' : ''}
          />
          {updateState.formError && (
            <p className="text-xs text-red-600">{updateState.formError}</p>
          )}
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="lg"
              disabled={updatePending}
              className="flex-1"
            >
              {updatePending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={() => setEditing(false)}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div>
            <div className="font-medium text-slate-900 break-all">
              {document.fileName}
            </div>
            {document.fileName !== document.originalFileName && (
              <div className="font-mono text-[10px] text-slate-400 break-all mt-0.5">
                {document.originalFileName}
              </div>
            )}
            {document.description && (
              <div className="mt-1.5 text-sm text-slate-600 whitespace-pre-wrap">
                {document.description}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="slate">
              {DOCUMENT_CATEGORY_LABEL[document.category]}
            </Badge>
            {document.visibleToClient ? (
              <Badge tone="green">✓ Client visible</Badge>
            ) : (
              <Badge tone="slate">Internal only</Badge>
            )}
            <span className="text-xs text-slate-500 tabular-nums">
              {formatBytes(document.byteSize)}
            </span>
          </div>

          <div className="text-xs text-slate-500">
            <div>{uploadedDate}</div>
            {document.uploaderName && (
              <div className="text-slate-400">by {document.uploaderName}</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            {previewable && (
              <a
                href={`/projects/${projectId}/documents/${document.id}/view`}
                target="_blank"
                rel="noopener noreferrer"
                className="col-span-1"
              >
                <Button size="lg" variant="outline" className="w-full">
                  Preview
                </Button>
              </a>
            )}
            <a
              href={`/projects/${projectId}/documents/${document.id}/download`}
              target="_blank"
              rel="noopener noreferrer"
              className={previewable ? 'col-span-1' : 'col-span-2'}
            >
              <Button size="lg" variant="outline" className="w-full">
                Download
              </Button>
            </a>
            {allowEdit && (
              <>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  onClick={() => setEditing(true)}
                  className="col-span-1"
                >
                  Edit
                </Button>
                <form action={deleteAction} className="col-span-1">
                  <ConfirmButton
                    size="lg"
                    variant="destructive"
                    confirmLabel="Tap again"
                    pendingLabel="Deleting…"
                    className="w-full"
                  >
                    Delete
                  </ConfirmButton>
                </form>
              </>
            )}
          </div>
        </>
      )}
    </article>
  );
}
