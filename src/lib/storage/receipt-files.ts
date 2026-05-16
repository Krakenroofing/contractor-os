// Supabase Storage helpers for receipt attachments.
//
// Bucket: `receipt-files` (PRIVATE). Must be created manually in the Supabase
// Dashboard before this code can run successfully. Path layout:
//
//   <companyId>/<year>/<month>/<uuid>.<ext>
//
// Same shape as statement-files and project-documents — companyId-first for
// tenant isolation, year/month for cleanup/lifecycle policies. Different
// bucket so RLS and lifecycle can diverge per asset class.

import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from '@/lib/auth/supabase-admin';

export const RECEIPT_FILES_BUCKET = 'receipt-files';

// 25 MB cap — photos from modern phones can be ~10 MB, supplier-invoice PDFs
// occasionally hit ~15 MB. Larger than statement-files (10 MB) because
// receipts are images, not CSVs.
export const MAX_RECEIPT_BYTES = 25 * 1024 * 1024;

// MIME allow-list. Heavy on images for the camera-capture flow, plus PDFs
// for supplier invoices.
export const ALLOWED_RECEIPT_MIME = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);

export const SIGNED_URL_TTL_SECONDS = 3600;

export class ReceiptStorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Receipt uploads require Supabase Storage. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and create the `receipt-files` bucket in Supabase Dashboard.',
    );
    this.name = 'ReceiptStorageNotConfiguredError';
  }
}

export function extForUpload(originalName: string, mime: string): string {
  const fromName = originalName.includes('.')
    ? originalName.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
  if (fromName && fromName.length <= 8) return fromName;
  switch (mime.toLowerCase()) {
    case 'application/pdf':
      return 'pdf';
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
    default:
      return 'bin';
  }
}

export type UploadReceiptInput = {
  companyId: string;
  bytes: ArrayBuffer | Buffer | Uint8Array;
  mimeType: string;
  originalFileName: string;
  uploadedAt?: Date;
};

export async function uploadReceiptFile(input: UploadReceiptInput): Promise<{
  storagePath: string;
}> {
  const client = getSupabaseAdminClient();
  if (!client) throw new ReceiptStorageNotConfiguredError();

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
    .from(RECEIPT_FILES_BUCKET)
    .upload(storagePath, body as Uint8Array, {
      contentType: input.mimeType || 'application/octet-stream',
      upsert: false,
    });
  if (error) {
    throw new Error(`Receipt upload failed: ${error.message}`);
  }
  return { storagePath };
}

export async function createSignedReceiptUrl(
  storagePath: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.storage
    .from(RECEIPT_FILES_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function deleteReceiptBlob(storagePath: string): Promise<void> {
  const client = getSupabaseAdminClient();
  if (!client) return;
  await client.storage.from(RECEIPT_FILES_BUCKET).remove([storagePath]);
}

/** Download a receipt blob from Supabase Storage. Used by the OCR action
 *  to read bytes server-side and forward to the OCR provider. */
export async function downloadReceiptBlob(
  storagePath: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const client = getSupabaseAdminClient();
  if (!client) throw new ReceiptStorageNotConfiguredError();
  const { data, error } = await client.storage
    .from(RECEIPT_FILES_BUCKET)
    .download(storagePath);
  if (error || !data) return null;
  const arrayBuffer = await data.arrayBuffer();
  return {
    bytes: new Uint8Array(arrayBuffer),
    mimeType: data.type || 'application/octet-stream',
  };
}
