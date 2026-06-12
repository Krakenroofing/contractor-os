// Client-side photo downscaling for uploads.
//
// WHY THIS EXISTS: photo uploads go through Next server actions, and
// Vercel hard-rejects serverless request bodies over ~4.5MB
// (FUNCTION_PAYLOAD_TOO_LARGE) — BEFORE the action runs, so the app's own
// 10MB check and error messaging never fire. Modern phone cameras shoot
// 4–8MB JPEGs, which is why field photos were silently disappearing: the
// POST died at the platform edge with no feedback. Downscaling to 2048px
// JPEG in the browser keeps every upload comfortably under the cap (and
// matches what the native Capacitor camera path already does via
// Camera.getPhoto({ width: 2048, quality: 80 })).
//
// Browser-only (canvas + createImageBitmap) — import from 'use client'
// components only.

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.82;
// Files already this small can't hit the platform cap and aren't worth
// re-encoding (quality loss for no transfer win).
const SKIP_BELOW_BYTES = 1_500_000;

/**
 * Downscale an image File to ≤2048px JPEG for upload. Returns the ORIGINAL
 * file untouched when it's already small, isn't an image, can't be decoded
 * (e.g. HEIC in a browser without a decoder), or when re-encoding doesn't
 * actually shrink it. Never throws.
 */
export async function downscalePhotoForUpload(file: File): Promise<File> {
  if (!file.type.toLowerCase().startsWith('image/')) return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;
  try {
    // 'from-image' bakes EXIF rotation into the pixels — canvas re-encoding
    // strips EXIF, so without this, portrait phone photos would land
    // sideways.
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
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob || blob.size === 0 || blob.size >= file.size) return file;
    const baseName = file.name.replace(/\.[a-z0-9]+$/i, '') || 'photo';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch {
    // Undecodable format — ship the original and let the server (or its
    // error message) deal with it.
    return file;
  }
}
