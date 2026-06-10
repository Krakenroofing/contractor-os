// Per-project "Download all" — bundles every daily-report photo for a project
// into one zip. JPEGs are already compressed, so we STORE (no recompression).
// Sequential downloads keep peak memory modest; a hard cap guards huge sets.

import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { getProject } from '@/lib/data/projects';
import { listPhotosForProject } from '@/lib/data/daily-reports';
import { downloadPhotoBytes } from '@/lib/storage/daily-report-photos';
import type { DailyReportPhoto } from '@/db/schema';

export const dynamic = 'force-dynamic';

// Above this, the in-memory zip gets risky — tell the operator to grab photos
// per report (or per photo) instead.
const MAX_PHOTOS_PER_ZIP = 800;

function extFor(p: DailyReportPhoto): string {
  if (p.fileName && p.fileName.includes('.')) {
    return p.fileName.split('.').pop()!.toLowerCase();
  }
  const m = (p.mimeType ?? '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic')) return 'heic';
  return 'jpg';
}

function entryName(p: DailyReportPhoto, i: number): string {
  const date = p.uploadedAt.toISOString().slice(0, 10);
  const short = p.id.slice(0, 8);
  // Index prefix guarantees uniqueness even if two photos share a date+id8.
  return `${String(i + 1).padStart(3, '0')}_${date}_${p.category}_${short}.${extFor(p)}`;
}

function safeFile(name: string): string {
  return name.replace(/[^a-z0-9-_ ]/gi, '_').slice(0, 60).trim() || 'project';
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const role = await getActiveRole();
  if (!canView(role, 'daily_reports')) {
    return new Response('Forbidden', { status: 403 });
  }
  const companyId = await getActiveCompanyId();
  const { projectId } = await params;

  const project = await getProject(companyId, projectId);
  if (!project) return new Response('Project not found', { status: 404 });

  const photos = await listPhotosForProject(companyId, projectId);
  if (photos.length === 0) {
    return new Response('No photos for this project.', { status: 404 });
  }
  if (photos.length > MAX_PHOTOS_PER_ZIP) {
    return new Response(
      `This project has ${photos.length} photos — too many for one zip. Download them per report, or per photo.`,
      { status: 413 },
    );
  }

  const zip = new JSZip();
  let added = 0;
  for (const [i, p] of photos.entries()) {
    const bytes = await downloadPhotoBytes(p.storagePath);
    if (!bytes) continue; // skip a missing/unreadable blob rather than fail all
    zip.file(entryName(p, i), bytes);
    added += 1;
  }
  if (added === 0) {
    return new Response('Could not read any photos from storage.', {
      status: 502,
    });
  }

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'STORE',
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeFile(project.name)}-photos.zip"`,
    },
  });
}
