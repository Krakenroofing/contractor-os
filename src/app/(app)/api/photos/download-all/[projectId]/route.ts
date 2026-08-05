// Per-project "Download all" — bundles every daily-report photo for a project
// into one zip. Bundling mechanics live in src/lib/photo-zip.ts (shared with
// the download-selected batch route).

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
      `This project has ${photos.length} photos — too many for one zip. Select photos in smaller batches instead.`,
      { status: 413 },
    );
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
      'Content-Disposition': `attachment; filename="${safeFile(project.name)}-photos.zip"`,
    },
  });
}
