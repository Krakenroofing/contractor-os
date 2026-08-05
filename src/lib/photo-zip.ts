import 'server-only';
import JSZip from 'jszip';
import { downloadPhotoBytes } from '@/lib/storage/daily-report-photos';
import type { DailyReportPhoto } from '@/db/schema';

// Shared zip-bundling helpers for the photo download routes (download-all
// and download-selected). JPEGs are already compressed, so entries are
// STOREd (no recompression); sequential downloads keep peak memory modest.

// Above this, the in-memory zip gets risky — tell the operator to grab
// photos in smaller batches instead.
export const MAX_PHOTOS_PER_ZIP = 800;

export function extFor(p: DailyReportPhoto): string {
  if (p.fileName && p.fileName.includes('.')) {
    return p.fileName.split('.').pop()!.toLowerCase();
  }
  const m = (p.mimeType ?? '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic')) return 'heic';
  return 'jpg';
}

export function entryName(p: DailyReportPhoto, i: number): string {
  const date = p.uploadedAt.toISOString().slice(0, 10);
  const short = p.id.slice(0, 8);
  // Index prefix guarantees uniqueness even if two photos share a date+id8.
  return `${String(i + 1).padStart(3, '0')}_${date}_${p.category}_${short}.${extFor(p)}`;
}

export function safeFile(name: string): string {
  return name.replace(/[^a-z0-9-_ ]/gi, '_').slice(0, 60).trim() || 'project';
}

/**
 * Bundle the given photos into a STORE zip. Missing/unreadable blobs are
 * skipped rather than failing the whole bundle; returns null when nothing
 * could be read at all.
 */
export async function buildPhotoZip(
  photos: DailyReportPhoto[],
): Promise<Buffer | null> {
  const zip = new JSZip();
  let added = 0;
  for (const [i, p] of photos.entries()) {
    const bytes = await downloadPhotoBytes(p.storagePath);
    if (!bytes) continue;
    zip.file(entryName(p, i), bytes);
    added += 1;
  }
  if (added === 0) return null;
  return await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}
