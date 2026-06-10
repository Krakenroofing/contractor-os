// Supabase Storage helpers for the Daily Reports photo pipeline.
//
// Bucket: `daily-report-photos` (PRIVATE). Must be created manually in the
// Supabase Dashboard before this code can run successfully. Path layout:
//
//   <companyId>/<projectId>/<reportId>/<uuid>.<ext>
//
// Keying by companyId first means every blob is naturally tenant-scoped, so
// future Storage RLS policies (if/when we add them) can use a simple prefix
// match. The reportId segment makes orphan cleanup easy when a report is
// hard-deleted: just remove the prefix.
//
// Demo mode: when SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL are
// missing, uploads surface PhotoStorageNotConfiguredError so the action
// layer can render a clean error to the user instead of crashing.

import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from '@/lib/auth/supabase-admin';

export const DAILY_REPORT_PHOTOS_BUCKET = 'daily-report-photos';

// Per-upload guards. Generous limits — field crews shoot phone photos that
// can be 8-12MB straight from the camera.
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB
export const ALLOWED_PHOTO_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

export class PhotoStorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Photo uploads require Supabase Storage. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and create the `daily-report-photos` bucket in Supabase Dashboard.',
    );
    this.name = 'PhotoStorageNotConfiguredError';
  }
}

function extFromMime(mime: string): string {
  switch (mime.toLowerCase()) {
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
    default:
      return 'bin';
  }
}

export type UploadDailyReportPhotoInput = {
  companyId: string;
  projectId: string;
  reportId: string;
  bytes: ArrayBuffer | Buffer | Uint8Array;
  mimeType: string;
};

export type UploadDailyReportPhotoResult = {
  storagePath: string;
};

export async function uploadDailyReportPhoto(
  input: UploadDailyReportPhotoInput,
): Promise<UploadDailyReportPhotoResult> {
  const client = getSupabaseAdminClient();
  if (!client) throw new PhotoStorageNotConfiguredError();

  const id = randomUUID();
  const ext = extFromMime(input.mimeType);
  const storagePath = `${input.companyId}/${input.projectId}/${input.reportId}/${id}.${ext}`;

  const body =
    input.bytes instanceof ArrayBuffer
      ? new Uint8Array(input.bytes)
      : input.bytes;

  const { error } = await client.storage
    .from(DAILY_REPORT_PHOTOS_BUCKET)
    .upload(storagePath, body as Uint8Array, {
      contentType: input.mimeType,
      upsert: false,
    });
  if (error) {
    throw new Error(`Photo upload failed: ${error.message}`);
  }
  return { storagePath };
}

export async function createSignedPhotoUrl(
  storagePath: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.storage
    .from(DAILY_REPORT_PHOTOS_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Signed URL that forces a download (Content-Disposition: attachment) with a
 * friendly filename. Backs the per-photo "Download" button on the Photos
 * browser — Supabase serves the bytes directly, no proxy through our server.
 */
export async function createSignedDownloadUrl(
  storagePath: string,
  filename: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.storage
    .from(DAILY_REPORT_PHOTOS_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds, { download: filename });
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Download a photo's bytes and return a base64 data URL suitable for
 * embedding in a server-rendered PDF (@react-pdf/renderer accepts data URLs
 * from `<Image src=...>`). Returns null if Storage isn't configured or the
 * download fails — callers should skip the photo rather than crash the
 * whole export.
 */
export async function getDailyReportPhotoDataUrl(
  storagePath: string,
  mimeType: string | null,
): Promise<string | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.storage
    .from(DAILY_REPORT_PHOTOS_BUCKET)
    .download(storagePath);
  if (error || !data) return null;
  try {
    const buf = Buffer.from(await data.arrayBuffer());
    const mime = mimeType || 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Raw photo bytes — used to build the per-project "Download all" zip.
 *  Returns null if Storage isn't configured or the object is missing. */
export async function downloadPhotoBytes(
  storagePath: string,
): Promise<Buffer | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.storage
    .from(DAILY_REPORT_PHOTOS_BUCKET)
    .download(storagePath);
  if (error || !data) return null;
  try {
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

export async function deleteDailyReportPhotoBlob(
  storagePath: string,
): Promise<void> {
  const client = getSupabaseAdminClient();
  if (!client) return; // demo: nothing to delete
  await client.storage
    .from(DAILY_REPORT_PHOTOS_BUCKET)
    .remove([storagePath]);
}
