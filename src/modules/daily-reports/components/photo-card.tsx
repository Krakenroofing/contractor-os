'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  updatePhotoAction,
  deletePhotoAction,
  type PhotoActionState,
} from '../actions';
import {
  photoCategoryValues,
  PHOTO_CATEGORY_LABEL,
  type PhotoCategory,
} from '../schema';

export type PhotoCardData = {
  id: string;
  caption: string;
  category: PhotoCategory;
  visibleToClient: boolean;
  fileName: string | null;
  signedUrl: string | null;
  uploadedAt: string;
};

export function PhotoCard({
  projectId,
  reportId,
  photo,
  allowEdit,
}: {
  projectId: string;
  reportId: string;
  photo: PhotoCardData;
  allowEdit: boolean;
}) {
  const updateBound = updatePhotoAction.bind(
    null,
    projectId,
    reportId,
    photo.id,
  );
  const deleteBound = deletePhotoAction.bind(
    null,
    projectId,
    reportId,
    photo.id,
  );
  const [updateState, updateAction, updatePending] = useActionState<
    PhotoActionState,
    FormData
  >(updateBound, {});
  const [, deleteAction] = useActionState<PhotoActionState, FormData>(
    deleteBound,
    {},
  );

  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-md border border-slate-200 bg-white overflow-hidden flex flex-col">
      <div className="aspect-video bg-slate-100 flex items-center justify-center overflow-hidden">
        {photo.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.signedUrl}
            alt={photo.caption || photo.fileName || 'Daily report photo'}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-xs text-slate-500 text-center p-3">
            Image unavailable
            <br />
            (Storage not configured?)
          </div>
        )}
      </div>

      <div className="p-3 space-y-2 text-sm">
        {editing && allowEdit ? (
          <form action={updateAction} className="space-y-2">
            <div>
              <Label className="text-[10px]">Caption</Label>
              <Input
                name="caption"
                defaultValue={photo.caption}
                placeholder="optional"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">Category</Label>
                <Select name="category" defaultValue={photo.category}>
                  {photoCategoryValues.map((c) => (
                    <option key={c} value={c}>
                      {PHOTO_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="visibleToClient"
                    defaultChecked={photo.visibleToClient}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="text-xs">Visible to client</span>
                </label>
              </div>
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
          <>
            <p className="text-slate-900">
              {photo.caption || (
                <span className="italic text-slate-400">No caption</span>
              )}
            </p>
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5">
                {PHOTO_CATEGORY_LABEL[photo.category]}
              </span>
              <span
                className={
                  photo.visibleToClient
                    ? 'text-emerald-700'
                    : 'text-slate-500'
                }
              >
                {photo.visibleToClient ? '✓ Visible to client' : '✕ Internal only'}
              </span>
            </div>
            {allowEdit && (
              <div className="flex items-center gap-2 pt-1">
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
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
