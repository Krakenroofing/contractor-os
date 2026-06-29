// Supabase Storage config for Team Task attachments.
//
// Bucket: `team-task-attachments` (PRIVATE — created in
// migrations/2026-06-29_team_tasks.sql). Path layout:
//
//   <companyId>/<taskId-or-staging>/<uuid>.<ext>
//
// Attachments are uploaded direct-to-storage via signed upload URLs (the same
// pattern as project documents — see src/lib/storage/signed-upload.ts), so the
// ~4.5MB Vercel action body cap never applies. The MIME allow-list and size
// cap are shared with project documents to keep one source of truth.

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

export const TEAM_TASK_ATTACHMENTS_BUCKET = 'team-task-attachments';

export {
  ALLOWED_DOCUMENT_MIME as ALLOWED_TEAM_TASK_MIME,
  MAX_DOCUMENT_BYTES as MAX_TEAM_TASK_BYTES,
  extForUpload as extForTeamTaskUpload,
};

export function createSignedTeamTaskAttachmentUrl(
  storagePath: string,
  ttlSeconds = 3600,
  options?: { download?: string | boolean },
): Promise<string | null> {
  return createSignedDownloadUrl(
    TEAM_TASK_ATTACHMENTS_BUCKET,
    storagePath,
    ttlSeconds,
    options,
  );
}

export function deleteTeamTaskAttachmentBlob(storagePath: string): Promise<void> {
  return removeStorageObject(TEAM_TASK_ATTACHMENTS_BUCKET, storagePath);
}
