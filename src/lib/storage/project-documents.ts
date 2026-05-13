// Supabase Storage helpers for the Project Documents repository.
//
// Bucket: `project-documents` (PRIVATE). Must be created manually in the
// Supabase Dashboard before this code can run successfully. Path layout:
//
//   <companyId>/<projectId>/<uuid>.<ext>
//
// Keying by companyId first means every blob is naturally tenant-scoped, so
// future Storage RLS policies (if/when we add them) can use a simple prefix
// match. The projectId segment makes orphan cleanup easy when a project is
// hard-deleted: just remove the prefix.
//
// Demo mode: when SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL are
// missing, uploads surface DocumentStorageNotConfiguredError so the action
// layer can render a clean error to the user instead of crashing.

import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from '@/lib/auth/supabase-admin';

export const PROJECT_DOCUMENTS_BUCKET = 'project-documents';

// 100MB cap. Generous for typical contracts/drawings/closeout binders.
// Larger video and CAD set use cases will lift this later.
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

// Allow-list of MIME types accepted on upload. Photos live alongside docs in
// the same bucket — image rows just have an image MIME. Future-ready slots
// for video are present but commented for clarity.
export const ALLOWED_DOCUMENT_MIME = new Set<string>([
  // PDF
  'application/pdf',
  // Word
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Excel
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // CSV / plain text
  'text/csv',
  'application/csv',
  'text/plain',
  // Images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  // CAD
  'application/acad',
  'application/x-acad',
  'application/autocad_dwg',
  'image/x-dwg',
  'image/vnd.dwg',
  'application/dwg',
  'application/x-dwg',
  'application/x-autocad',
  'image/vnd.dxf',
  'application/dxf',
  // Archives
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream', // some browsers send this for .dwg/.dxf — accepted with caution
]);

export const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

export class DocumentStorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Document uploads require Supabase Storage. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and create the `project-documents` bucket in Supabase Dashboard.',
    );
    this.name = 'DocumentStorageNotConfiguredError';
  }
}

// Best-effort extension recovery. Prefer the original filename's extension —
// .dwg / .dxf / .heic etc. don't have unambiguous MIME types. Falls back to
// a MIME-derived ext, then 'bin'.
export function extForUpload(originalName: string, mime: string): string {
  const fromName = originalName.includes('.')
    ? originalName.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
  if (fromName && fromName.length <= 8) return fromName;
  switch (mime.toLowerCase()) {
    case 'application/pdf':
      return 'pdf';
    case 'application/msword':
      return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'application/vnd.ms-excel':
      return 'xls';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx';
    case 'text/csv':
    case 'application/csv':
      return 'csv';
    case 'text/plain':
      return 'txt';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    case 'image/gif':
      return 'gif';
    case 'application/zip':
    case 'application/x-zip-compressed':
      return 'zip';
    default:
      return 'bin';
  }
}

export type UploadProjectDocumentInput = {
  companyId: string;
  projectId: string;
  bytes: ArrayBuffer | Buffer | Uint8Array;
  mimeType: string;
  originalFileName: string;
};

export type UploadProjectDocumentResult = {
  storagePath: string;
};

export async function uploadProjectDocument(
  input: UploadProjectDocumentInput,
): Promise<UploadProjectDocumentResult> {
  const client = getSupabaseAdminClient();
  if (!client) throw new DocumentStorageNotConfiguredError();

  const id = randomUUID();
  const ext = extForUpload(input.originalFileName, input.mimeType);
  const storagePath = `${input.companyId}/${input.projectId}/${id}.${ext}`;

  const body =
    input.bytes instanceof ArrayBuffer
      ? new Uint8Array(input.bytes)
      : input.bytes;

  const { error } = await client.storage
    .from(PROJECT_DOCUMENTS_BUCKET)
    .upload(storagePath, body as Uint8Array, {
      contentType: input.mimeType || 'application/octet-stream',
      upsert: false,
    });
  if (error) {
    throw new Error(`Document upload failed: ${error.message}`);
  }
  return { storagePath };
}

export async function createSignedDocumentUrl(
  storagePath: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
  options?: { download?: string | boolean },
): Promise<string | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.storage
    .from(PROJECT_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds, options);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function deleteProjectDocumentBlob(
  storagePath: string,
): Promise<void> {
  const client = getSupabaseAdminClient();
  if (!client) return; // demo: nothing to delete
  await client.storage
    .from(PROJECT_DOCUMENTS_BUCKET)
    .remove([storagePath]);
}
