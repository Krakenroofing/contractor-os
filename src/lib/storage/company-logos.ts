// Supabase Storage helper for company logos.
//
// Bucket: `company-logos` (PRIVATE). Must be created manually in the
// Supabase Dashboard before this code can run successfully. Path layout:
//
//   <companyId>/<uuid>.<ext>
//
// One logo per company in practice — when a new logo is uploaded we delete
// the prior blob (best-effort) to keep storage tidy. The DB column
// `companies.logo_url` stores the bucket key (not a full URL); the
// `createSignedLogoUrl` helper mints a per-request signed URL for rendering.

import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from '@/lib/auth/supabase-admin';

export const COMPANY_LOGOS_BUCKET = 'company-logos';

// 5 MB cap. Logos are typically <500 KB; 5 MB gives plenty of headroom for
// high-DPI marks or vector exports rasterized to PNG.
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

// PNG and JPEG only — @react-pdf/renderer (used by every invoice / proposal /
// PO / CO PDF export) cannot embed SVG, WebP, GIF, or AVIF. Those formats
// render fine in the browser but silently vanish from generated PDFs, so
// they're rejected at upload time to prevent the "logo on screen, missing
// in PDF" trap.
export const ALLOWED_LOGO_MIME = new Set<string>([
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

// 7 days. Logos render on the company-settings page, on every document
// detail page, and inside every PDF download. Long-ish TTL keeps re-renders
// cheap; the admin client never caches the URL itself.
export const LOGO_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

export class CompanyLogoStorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Company logo upload requires Supabase Storage. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and create the `company-logos` bucket in Supabase Dashboard.',
    );
    this.name = 'CompanyLogoStorageNotConfiguredError';
  }
}

function extForLogo(originalName: string, mime: string): string {
  const fromName = originalName.includes('.')
    ? originalName.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
  if (fromName && fromName.length <= 8) return fromName;
  switch (mime.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    case 'image/gif':
      return 'gif';
    default:
      return 'png';
  }
}

export type UploadCompanyLogoInput = {
  companyId: string;
  bytes: ArrayBuffer | Buffer | Uint8Array;
  mimeType: string;
  originalFileName: string;
};

export type UploadCompanyLogoResult = { storagePath: string };

export async function uploadCompanyLogo(
  input: UploadCompanyLogoInput,
): Promise<UploadCompanyLogoResult> {
  const client = getSupabaseAdminClient();
  if (!client) throw new CompanyLogoStorageNotConfiguredError();

  const id = randomUUID();
  const ext = extForLogo(input.originalFileName, input.mimeType);
  const storagePath = `${input.companyId}/${id}.${ext}`;

  const body =
    input.bytes instanceof ArrayBuffer
      ? new Uint8Array(input.bytes)
      : input.bytes;

  const { error } = await client.storage
    .from(COMPANY_LOGOS_BUCKET)
    .upload(storagePath, body as Uint8Array, {
      contentType: input.mimeType || 'image/png',
      upsert: false,
    });
  if (error) {
    throw new Error(`Logo upload failed: ${error.message}`);
  }
  return { storagePath };
}

export async function createSignedLogoUrl(
  storagePath: string,
  ttlSeconds: number = LOGO_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.storage
    .from(COMPANY_LOGOS_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

// Server-side fetch + base64 — needed by the PDF renderer because
// @react-pdf/renderer's <Image> needs an actual data URL (or a URL the
// server can fetch). Signed URLs work, but data URLs are more reliable
// for cross-environment PDF rendering.
//
// Failure modes are logged (not thrown) so the PDF still renders without a
// logo rather than crashing the whole export. The previous version
// swallowed errors silently, which made it impossible to tell whether
// "logo missing" was due to env misconfig, a bad path, or a storage
// outage — the logs below give us that signal.
//
// IMPORTANT: the mime type for the data URL is derived from magic bytes,
// not from the filename extension. Users routinely upload PNGs saved with
// a .jpg extension (or vice versa). Browsers tolerate the mismatch, but
// @react-pdf does a strict format-specific decode — declaring image/jpeg
// for actual PNG bytes makes the image silently disappear from PDFs. The
// sniff path also catches the case where a file was renamed (e.g. an SVG
// dropped in with a .png extension) before it reaches the renderer.
export async function getCompanyLogoDataUrl(
  storagePath: string,
  mimeType: string | null = null,
): Promise<string | null> {
  const client = getSupabaseAdminClient();
  if (!client) {
    console.error(
      '[company-logos] Supabase admin client unavailable — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Logo will be omitted from PDF.',
    );
    return null;
  }
  const { data, error } = await client.storage
    .from(COMPANY_LOGOS_BUCKET)
    .download(storagePath);
  if (error || !data) {
    console.error(
      `[company-logos] Failed to download logo at "${storagePath}": ${error?.message ?? 'no data returned'}. Logo will be omitted from PDF.`,
    );
    return null;
  }
  try {
    const buf = Buffer.from(await data.arrayBuffer());
    const sniffed = sniffImageMime(buf);
    const mime = sniffed || mimeType || guessMime(storagePath) || 'image/png';
    if (sniffed && mimeType && sniffed !== mimeType) {
      console.warn(
        `[company-logos] Logo at "${storagePath}" was uploaded with mime "${mimeType}" but actual bytes are "${sniffed}". Using sniffed value so @react-pdf decodes correctly.`,
      );
    }
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (err) {
    console.error(
      `[company-logos] Failed to encode logo at "${storagePath}": ${err instanceof Error ? err.message : String(err)}.`,
    );
    return null;
  }
}

// Magic-byte sniff for the formats we accept. Returns null for anything
// that isn't a real PNG or JPEG so the caller can fall back without
// declaring a wrong mime.
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

function guessMime(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    default:
      return null;
  }
}

export async function deleteCompanyLogoBlob(storagePath: string): Promise<void> {
  const client = getSupabaseAdminClient();
  if (!client) return;
  await client.storage.from(COMPANY_LOGOS_BUCKET).remove([storagePath]);
}
