// Supabase Storage config for journal-entry attachments (the working papers
// behind a manual adjustment).
//
// Bucket: `journal-entry-attachments` (PRIVATE — created in
// migrations/2026-08-28_journal_entry_attachments.sql). Path layout:
//
//   <companyId>/<journalEntryId>/<uuid>.<ext>
//
// Direct-to-storage via signed upload URLs (same pattern as team-task
// attachments); MIME allow-list and size cap shared with project documents.

import 'server-only';
import {
  ALLOWED_DOCUMENT_MIME,
  MAX_DOCUMENT_BYTES,
  extForUpload,
} from '@/lib/storage/project-documents';
import {
  createSignedDownloadUrl,
  removeStorageObject,
} from '@/lib/storage/signed-upload';

export const JOURNAL_ENTRY_ATTACHMENTS_BUCKET = 'journal-entry-attachments';

export {
  ALLOWED_DOCUMENT_MIME as ALLOWED_JOURNAL_ATTACHMENT_MIME,
  MAX_DOCUMENT_BYTES as MAX_JOURNAL_ATTACHMENT_BYTES,
  extForUpload as extForJournalAttachmentUpload,
};

export function createSignedJournalAttachmentUrl(
  storagePath: string,
  ttlSeconds = 3600,
  options?: { download?: string | boolean },
): Promise<string | null> {
  return createSignedDownloadUrl(
    JOURNAL_ENTRY_ATTACHMENTS_BUCKET,
    storagePath,
    ttlSeconds,
    options,
  );
}

export function deleteJournalAttachmentBlob(storagePath: string): Promise<void> {
  return removeStorageObject(JOURNAL_ENTRY_ATTACHMENTS_BUCKET, storagePath);
}
