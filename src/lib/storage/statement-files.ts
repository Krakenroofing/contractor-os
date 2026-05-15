// Supabase Storage helpers for bank-statement import files.
//
// Bucket: `statement-files` (PRIVATE). Must be created manually in the
// Supabase Dashboard before this code can run successfully. Path layout:
//
//   <companyId>/<year>/<month>/<uuid>.<ext>
//
// Keying by companyId first means every blob is naturally tenant-scoped.
// The year/month segments make orphan cleanup and lifecycle policies easy.
//
// Mirrors src/lib/storage/project-documents.ts. Different bucket so RLS,
// lifecycle, and quota policies can diverge.

import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from '@/lib/auth/supabase-admin';

export const STATEMENT_FILES_BUCKET = 'statement-files';

// 10 MB cap. Real bank statements are typically <1 MB CSV / <5 MB XLSX —
// anything larger is almost certainly a wrong file.
export const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;

// MIME allow-list. CSV variants (text/csv, application/csv) plus XLSX. Some
// browsers send application/octet-stream for .csv from Excel-saved files;
// we accept that and rely on the extension recovery in extForUpload.
export const ALLOWED_STATEMENT_MIME = new Set<string>([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

export const SIGNED_URL_TTL_SECONDS = 3600;

export class StatementStorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Statement uploads require Supabase Storage. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and create the `statement-files` bucket in Supabase Dashboard.',
    );
    this.name = 'StatementStorageNotConfiguredError';
  }
}

export function extForUpload(originalName: string, mime: string): string {
  const fromName = originalName.includes('.')
    ? originalName.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
  if (fromName && fromName.length <= 8) return fromName;
  switch (mime.toLowerCase()) {
    case 'text/csv':
    case 'application/csv':
      return 'csv';
    case 'application/vnd.ms-excel':
      return 'xls';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx';
    case 'text/plain':
      return 'txt';
    default:
      return 'bin';
  }
}

export type UploadStatementInput = {
  companyId: string;
  bytes: ArrayBuffer | Buffer | Uint8Array;
  mimeType: string;
  originalFileName: string;
  // Date used to build the year/month folders. Defaults to "now". Callers
  // can pass an explicit date so a backfill of older statements lands in
  // the correct year/month folder.
  uploadedAt?: Date;
};

export type UploadStatementResult = {
  storagePath: string;
};

export async function uploadStatementFile(
  input: UploadStatementInput,
): Promise<UploadStatementResult> {
  const client = getSupabaseAdminClient();
  if (!client) throw new StatementStorageNotConfiguredError();

  const id = randomUUID();
  const ext = extForUpload(input.originalFileName, input.mimeType);
  const when = input.uploadedAt ?? new Date();
  const year = when.getUTCFullYear().toString();
  const month = String(when.getUTCMonth() + 1).padStart(2, '0');
  const storagePath = `${input.companyId}/${year}/${month}/${id}.${ext}`;

  const body =
    input.bytes instanceof ArrayBuffer
      ? new Uint8Array(input.bytes)
      : input.bytes;

  const { error } = await client.storage
    .from(STATEMENT_FILES_BUCKET)
    .upload(storagePath, body as Uint8Array, {
      contentType: input.mimeType || 'application/octet-stream',
      upsert: false,
    });
  if (error) {
    throw new Error(`Statement upload failed: ${error.message}`);
  }
  return { storagePath };
}

export async function createSignedStatementUrl(
  storagePath: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
  options?: { download?: string | boolean },
): Promise<string | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.storage
    .from(STATEMENT_FILES_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds, options);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function downloadStatementBytes(
  storagePath: string,
): Promise<Uint8Array | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.storage
    .from(STATEMENT_FILES_BUCKET)
    .download(storagePath);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

export async function deleteStatementBlob(storagePath: string): Promise<void> {
  const client = getSupabaseAdminClient();
  if (!client) return;
  await client.storage.from(STATEMENT_FILES_BUCKET).remove([storagePath]);
}
