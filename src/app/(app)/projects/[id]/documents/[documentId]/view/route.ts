import { NextRequest, NextResponse } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/data/projects';
import { getProjectDocument } from '@/lib/data/project-documents';
import { createSignedDocumentUrl } from '@/lib/storage/project-documents';

export const dynamic = 'force-dynamic';

// GET /projects/<id>/documents/<documentId>/view
//
// Sibling of the download route. The only behavioural difference: this route
// mints a signed URL WITHOUT the `download` option, so Supabase returns the
// object with its real Content-Type — browsers then render PDFs, images, and
// text inline instead of forcing a save dialog. For MIME types the browser
// can't render natively, the user will get the standard download prompt.
//
// Auth + scoping rules identical to the download route — defense-in-depth
// against URL-tampering and cross-tenant access.
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

  const project = await getProject(companyId, id);
  if (!project) return new NextResponse('Not found', { status: 404 });

  const doc = await getProjectDocument(companyId, documentId);
  if (!doc || doc.projectId !== project.id) {
    return new NextResponse('Not found', { status: 404 });
  }

  const url = await createSignedDocumentUrl(doc.storagePath, 3600);
  if (!url) {
    return new NextResponse(
      'Document storage is not configured. Contact your administrator.',
      { status: 503 },
    );
  }

  return NextResponse.redirect(url);
}
