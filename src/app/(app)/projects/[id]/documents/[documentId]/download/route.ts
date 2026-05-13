import { NextRequest, NextResponse } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/data/projects';
import { getProjectDocument } from '@/lib/data/project-documents';
import { createSignedDocumentUrl } from '@/lib/storage/project-documents';

export const dynamic = 'force-dynamic';

// GET /projects/<id>/documents/<documentId>/download
//
// Authorizes the request against the active company + role, then mints a
// short-lived signed URL for the underlying Supabase Storage object and
// redirects to it. The signed URL is asked to deliver the original filename
// via Content-Disposition (Supabase honors the `download` option for this).
//
// Why redirect to Supabase rather than stream the bytes back through Next.js?
// Streaming would route every download through the Vercel function and burn
// runtime + bandwidth. Signed URLs hit Supabase's CDN directly and expire
// after an hour, so the auth check still gates access.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  await requireAuth();
  const role = await getActiveRole();
  if (!canView(role, 'documents')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { id, documentId } = await params;
  const companyId = await getActiveCompanyId();

  // Verify the project belongs to the active company. Defense-in-depth:
  // getProjectDocument() already scopes by companyId, but checking the
  // project URL segment too catches malformed URLs early.
  const project = await getProject(companyId, id);
  if (!project) return new NextResponse('Not found', { status: 404 });

  const doc = await getProjectDocument(companyId, documentId);
  if (!doc || doc.projectId !== project.id) {
    return new NextResponse('Not found', { status: 404 });
  }

  const url = await createSignedDocumentUrl(doc.storagePath, 3600, {
    download: doc.originalFileName,
  });
  if (!url) {
    return new NextResponse(
      'Document storage is not configured. Contact your administrator.',
      { status: 503 },
    );
  }

  return NextResponse.redirect(url);
}
