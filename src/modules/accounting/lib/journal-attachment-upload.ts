// Browser-side upload routine for journal-entry attachments, shared by the
// entry form (files picked before the entry exists) and the attachments block
// on a posted entry. Mints signed URLs, PUTs each blob straight to storage,
// then records the refs. Returns human-readable problems, never throws.
//
// Lives outside the 'use client' components on purpose: a helper exported from
// a 'use client' module reads as a client reference when a server file imports
// it, which fails silently.

import {
  attachJournalEntryFilesAction,
  createJournalAttachmentUploadUrlsAction,
} from '../gl-actions';

export async function uploadJournalAttachments(
  entryId: string,
  files: File[],
): Promise<string[]> {
  if (files.length === 0) return [];
  const problems: string[] = [];
  const grants = await createJournalAttachmentUploadUrlsAction(
    entryId,
    files.map((f) => ({
      fileName: f.name,
      mimeType: f.type || 'application/octet-stream',
      byteSize: f.size,
    })),
  );
  if (grants.formError) return [grants.formError];

  const refs: Array<{
    storagePath: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
  }> = [];
  for (const f of files) {
    const grant = grants.uploads?.find((u) => u.fileName === f.name);
    if (!grant || !grant.signedUrl || !grant.storagePath) {
      problems.push(`${f.name}: ${grant?.error ?? 'no upload URL.'}`);
      continue;
    }
    try {
      const res = await fetch(grant.signedUrl, {
        method: 'PUT',
        headers: { 'content-type': f.type || 'application/octet-stream' },
        body: f,
      });
      if (!res.ok) {
        problems.push(`${f.name}: upload failed (${res.status}).`);
        continue;
      }
      refs.push({
        storagePath: grant.storagePath,
        fileName: f.name,
        mimeType: f.type || 'application/octet-stream',
        byteSize: f.size,
      });
    } catch {
      problems.push(`${f.name}: upload failed.`);
    }
  }
  if (refs.length > 0) {
    const attach = await attachJournalEntryFilesAction(entryId, refs);
    if (!attach.ok) problems.push(attach.error ?? 'Could not attach.');
    else if (attach.failures) problems.push(...attach.failures);
  }
  return problems;
}
