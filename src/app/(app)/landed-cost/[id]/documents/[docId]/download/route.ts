import { NextRequest, NextResponse } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { requireAuth } from '@/lib/auth';
import {
  getLandedCost,
  getLandedCostAttachment,
} from '@/lib/data/landed-costs';
import { createSignedDocumentUrl } from '@/lib/storage/project-documents';

export const dynamic = 'force-dynamic';

// GET /landed-cost/<id>/documents/<docId>/download
// Authorizes against the active company + role, then redirects to a short-lived
// signed URL for the blob (in the shared project-documents bucket).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  await requireAuth();
  const role = await getActiveRole();
  if (!canView(role, 'landed_cost')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { id, docId } = await params;
  const companyId = await getActiveCompanyId();

  const entry = await getLandedCost(companyId, id);
  if (!entry) return new NextResponse('Not found', { status: 404 });

  const doc = await getLandedCostAttachment(companyId, docId);
  if (!doc || doc.landedCostId !== entry.id) {
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
