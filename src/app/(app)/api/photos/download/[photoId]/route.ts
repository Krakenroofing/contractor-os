// Per-photo download. Verifies the caller can view daily reports + that the
// photo belongs to the active company, then 302s to a short-lived signed URL
// with Content-Disposition: attachment (Supabase serves the bytes directly).

import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { getPhoto } from '@/lib/data/daily-reports';
import { getWorkOrderPhoto } from '@/lib/data/work-orders';
import { createSignedDownloadUrl } from '@/lib/storage/daily-report-photos';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ photoId: string }> },
) {
  const role = await getActiveRole();
  if (!canView(role, 'daily_reports')) {
    return new Response('Forbidden', { status: 403 });
  }
  const companyId = await getActiveCompanyId();
  const { photoId } = await params;

  // Daily-report photo first; fall back to a work-order photo (same
  // private bucket, same signed-download helper).
  const photo =
    (await getPhoto(companyId, photoId)) ??
    (await getWorkOrderPhoto(companyId, photoId));
  if (!photo) return new Response('Not found', { status: 404 });

  const filename = photo.fileName ?? `photo-${photo.id}.jpg`;
  const url = await createSignedDownloadUrl(photo.storagePath, filename);
  if (!url) return new Response('Storage not configured', { status: 500 });

  return Response.redirect(url, 302);
}
