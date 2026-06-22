// Client-side logo downscaling for uploads.
//
// WHY THIS EXISTS: company-logo uploads go through a Next server action, and
// Vercel hard-rejects serverless request bodies over ~4.5MB
// (FUNCTION_PAYLOAD_TOO_LARGE) BEFORE the action runs — so the action's own
// size check and error messaging never fire and the upload silently
// disappears (companies.logo_url stays null). This is the same edge that bit
// field-photo uploads; see ./downscale-photo.ts.
//
// Logos differ from photos in one way that matters: they're often PNGs with
// transparency, and invoices/proposals render them on a white header. So
// unlike the photo path (which always re-encodes to JPEG), this keeps PNG
// when it can — only falling back to a WHITE-background JPEG when PNG doesn't
// get the file under the cap. A black-background flatten would look wrong on
// every branded document.
//
// Browser-only (canvas + createImageBitmap) — import from 'use client' only.

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.9;
// Files this small can't hit the platform cap; leave them untouched so a
// small transparent PNG keeps its exact bytes/format.
const SKIP_BELOW_BYTES = 3_000_000;

/**
 * Downscale a logo image File to <=2048px for upload. Prefers PNG (preserves
 * transparency); falls back to white-background JPEG only if PNG isn't smaller.
 * Returns the ORIGINAL file untouched when it's already small, isn't an image,
 * can't be decoded, or when neither re-encode actually shrinks it. Never throws.
 */
export async function downscaleLogoForUpload(file: File): Promise<File> {
  if (!file.type.toLowerCase().startsWith('image/')) return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    });
    const scale = Math.min(
      1,
      MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const toBlob = (type: string, quality?: number) =>
      new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, quality),
      );
    const baseName = file.name.replace(/\.[a-z0-9]+$/i, '') || 'logo';

    // 1) Prefer PNG — keeps transparency.
    const png = await toBlob('image/png');
    if (png && png.size > 0 && png.size < file.size) {
      bitmap.close();
      return new File([png], `${baseName}.png`, { type: 'image/png' });
    }

    // 2) PNG didn't shrink it (e.g. a photographic logo). Flatten onto white
    //    and ship JPEG so the body stays under the cap.
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    const jpeg = await toBlob('image/jpeg', JPEG_QUALITY);
    bitmap.close();
    if (jpeg && jpeg.size > 0 && jpeg.size < file.size) {
      return new File([jpeg], `${baseName}.jpg`, { type: 'image/jpeg' });
    }
    return file;
  } catch {
    return file;
  }
}
