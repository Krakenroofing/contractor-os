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
  type DocumentCategory,
} from '../schema';
import { canPreviewInline } from '../lib/preview';

export type DocumentRowData = {
  id: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  category: DocumentCategory;
  description: string | null;
  visibleToClient: boolean;
  uploadedAt: string;
  uploaderName: string | null;
  // Set when the document is pinned to a specific change order.
  changeOrderId: string | null;
  changeOrderNumber: string | null;
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function DocumentRow({
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
    <tr className="border-b border-slate-100 hover:bg-slate-50 align-top">
      <td className="px-4 py-3">
        {editing && allowEdit ? (
          <form action={updateAction} className="space-y-2">
            <div>
              <Label className="text-[10px]">File name</Label>
              <Input name="fileName" defaultValue={document.fileName} required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">Category</Label>
                <Select name="category" defaultValue={document.category}>
                  {documentCategoryValues.map((c) => (
                    <option key={c} value={c}>
                      {DOCUMENT_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </div>
              {/* "Visible to client" control hidden until a client portal
                  exists (the flag gates nothing today). Preserve the stored
                  value so an edit can't silently flip it. */}
              <input
                type="hidden"
                name="visibleToClient"
                value={document.visibleToClient ? 'on' : ''}
              />
            </div>
            <div>
              <Label className="text-[10px]">Description</Label>
              <Input
                name="description"
                defaultValue={documentDescriptionDefault(document.description)}
                placeholder="optional"
              />
            </div>
            {updateState.formError && (
              <p className="text-xs text-red-600">{updateState.formError}</p>
            )}
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={updatePending}>
                {updatePending ? 'Saving…' : 'Save'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <div className="font-medium text-slate-900 break-all">
              {document.fileName}
            </div>
            {document.fileName !== document.originalFileName && (
              <div className="font-mono text-[10px] text-slate-400 break-all">
                {document.originalFileName}
              </div>
            )}
            {document.description && (
              <div className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">
                {document.description}
              </div>
            )}
            {document.changeOrderNumber && document.changeOrderId && (
              <a
                href={`/change-orders/${document.changeOrderId}`}
                className="mt-1 inline-flex items-center rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
              >
                ↳ {document.changeOrderNumber}
              </a>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-slate-700">
        <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs">
          {DOCUMENT_CATEGORY_LABEL[document.category]}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-slate-600 tabular-nums">
        {formatBytes(document.byteSize)}
      </td>
      <td className="px-4 py-3">
        {document.visibleToClient ? (
          <Badge tone="green">✓ Client visible</Badge>
        ) : (
          <Badge tone="slate">Internal only</Badge>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-slate-600">
        <div>{uploadedDate}</div>
        {document.uploaderName && (
          <div className="text-slate-400">{document.uploaderName}</div>
        )}
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1">
          {previewable && (
            <a
              href={`/projects/${projectId}/documents/${document.id}/view`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="sm" variant="outline">
                Preview
              </Button>
            </a>
          )}
          <a
            href={`/projects/${projectId}/documents/${document.id}/download`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="sm" variant="outline">
              Download
            </Button>
          </a>
          {allowEdit && !editing && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
              <form action={deleteAction}>
                <ConfirmButton
                  size="sm"
                  variant="destructive"
                  confirmLabel="Click again"
                  pendingLabel="Deleting…"
                >
                  Delete
                </ConfirmButton>
              </form>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// Tiny helper to keep the JSX above readable. defaultValue can't be null on
// an <input>, so we coerce to empty string.
function documentDescriptionDefault(desc: string | null): string {
  return desc ?? '';
}
