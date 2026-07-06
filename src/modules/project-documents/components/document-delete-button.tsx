'use client';

import { useActionState } from 'react';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { deleteDocumentAction, type DocumentActionState } from '../actions';

// Standalone delete control for a single document. The full documents table
// (DocumentRow / DocumentCard) has its own inline delete; this is for lighter
// surfaces that just list files — e.g. the change order "Files" card.
export function DocumentDeleteButton({
  projectId,
  documentId,
}: {
  projectId: string;
  documentId: string;
}) {
  const bound = deleteDocumentAction.bind(null, projectId, documentId);
  const [, action] = useActionState<DocumentActionState, FormData>(bound, {});
  return (
    <form action={action}>
      <ConfirmButton
        size="sm"
        variant="destructive"
        confirmLabel="Click again"
        pendingLabel="Deleting…"
      >
        Delete
      </ConfirmButton>
    </form>
  );
}
