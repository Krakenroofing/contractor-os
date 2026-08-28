import { NextRequest, NextResponse } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { requireAuth } from '@/lib/auth';
import { getJournalEntryAttachment } from '@/lib/data/journal-entry-attachments';
import { createSignedJournalAttachmentUrl } from '@/lib/storage/journal-entry-attachments';

export const dynamic = 'force-dynamic';

// GET /accounting/journal/attachments/<attachmentId>/download
//
// Authorizes against the active company + role, then mints a short-lived
// signed URL for the Storage object and redirects (same pattern as team-task
// attachment downloads). `?view=1` serves inline (images open in the browser
// instead of forcing a save).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  await requireAuth();
  const role = await getActiveRole();
  if (!canView(role, 'accounting_accounts')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { attachmentId } = await params;
  const companyId = await getActiveCompanyId();

  const attachment = await getJournalEntryAttachment(companyId, attachmentId);
  if (!attachment) return new NextResponse('Not found', { status: 404 });

  const inline = req.nextUrl.searchParams.get('view') === '1';
  const url = await createSignedJournalAttachmentUrl(
    attachment.storagePath,
    3600,
    inline ? undefined : { download: attachment.originalFileName },
  );
  if (!url) {
    return new NextResponse(
      'Attachment storage is not configured. Contact your administrator.',
      { status: 503 },
    );
  }

  return NextResponse.redirect(url);
}
