'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { deleteReceiptAttachmentAction } from '../actions';

export type AttachmentRow = {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  uploadedAt: string;
  signedUrl: string | null;
  kind: 'receipt_image' | 'supplier_invoice' | 'other';
};

export function AttachmentsList({
  receiptId,
  attachments,
  canEdit,
}: {
  receiptId: string;
  attachments: AttachmentRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onDelete(id: string) {
    if (!confirm('Delete this attachment?')) return;
    startTransition(async () => {
      const res = await deleteReceiptAttachmentAction({
        receiptId,
        attachmentId: id,
      });
      if (!res.ok && res.error) alert(res.error);
      router.refresh();
    });
  }

  if (attachments.length === 0) {
    return (
      <p className="text-sm text-slate-500">No attachments yet.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {attachments.map((a) => {
        const isImage = a.mimeType.startsWith('image/');
        return (
          <li
            key={a.id}
            className="flex items-center gap-3 rounded border border-slate-200 bg-white p-2"
          >
            {isImage && a.signedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={a.signedUrl}
                alt={a.originalFilename}
                className="h-16 w-16 object-cover rounded"
              />
            ) : (
              <div className="h-16 w-16 flex items-center justify-center rounded bg-slate-100 text-xs text-slate-600">
                {a.mimeType.includes('pdf') ? 'PDF' : 'FILE'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">
                {a.signedUrl ? (
                  <a
                    href={a.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {a.originalFilename}
                  </a>
                ) : (
                  a.originalFilename
                )}
              </div>
              <div className="text-[11px] text-slate-500">
                {(a.byteSize / 1024).toFixed(0)} KB · {a.uploadedAt}
              </div>
            </div>
            {canEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => onDelete(a.id)}
              >
                Delete
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
