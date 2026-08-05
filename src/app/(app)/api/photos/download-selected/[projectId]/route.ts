// Batch photo download — bundles a SELECTED subset of a project's
// daily-report photos into one zip. The photo ids arrive as a form POST
// (a plain form submission so the browser treats the response as a normal
// file download); ids are validated against the project's own photo list,
// so a foreign or cross-project id is silently ignored rather than leaked.

import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { getProject } from '@/lib/data/projects';
import { listPhotosForProject } from '@/lib/data/daily-reports';
import {
  buildPhotoZip,
  MAX_PHOTOS_PER_ZIP,
  safeFile,
} from '@/lib/photo-zip';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
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

  let ids: string[];
  try {
    const form = await req.formData();
    const raw = form.get('photoIds');
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : null;
    if (
      !Array.isArray(parsed) ||
      parsed.some((x) => typeof x !== 'string')
    ) {
      return new Response('Bad photo selection.', { status: 400 });
    }
    ids = parsed;
  } catch {
    return new Response('Bad photo selection.', { status: 400 });
  }
  if (ids.length === 0) {
    return new Response('No photos selected.', { status: 400 });
  }
  if (ids.length > MAX_PHOTOS_PER_ZIP) {
    return new Response(
      `Too many photos selected (${ids.length}) — the limit per zip is ${MAX_PHOTOS_PER_ZIP}.`,
      { status: 413 },
    );
  }

  // Resolve ids against this project's own photos — anything else drops out.
  const wanted = new Set(ids);
  const photos = (await listPhotosForProject(companyId, projectId)).filter(
    (p) => wanted.has(p.id),
  );
  if (photos.length === 0) {
    return new Response('No matching photos found.', { status: 404 });
  }

  const buf = await buildPhotoZip(photos);
  if (!buf) {
    return new Response('Could not read any photos from storage.', {
      status: 502,
    });
  }

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeFile(project.name)}-photos-${photos.length}.zip"`,
    },
  });
}
