import { NextRequest, NextResponse } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { requireAuth } from '@/lib/auth';
import {
  getTeamTask,
  getTeamTaskAttachment,
} from '@/lib/data/team-tasks';
import { createSignedTeamTaskAttachmentUrl } from '@/lib/storage/team-task-attachments';

export const dynamic = 'force-dynamic';

// GET /dashboard/tasks/<taskId>/attachments/<attachmentId>/download
//
// Authorizes against the active company + role, then mints a short-lived
// signed URL for the Supabase Storage object and redirects to it (same
// pattern as project-document downloads — keeps bytes off the Vercel
// function and behind an expiring URL).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string; attachmentId: string }> },
) {
  await requireAuth();
  const role = await getActiveRole();
  if (!canView(role, 'team_tasks')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { taskId, attachmentId } = await params;
  const companyId = await getActiveCompanyId();

  const task = await getTeamTask(companyId, taskId);
  if (!task) return new NextResponse('Not found', { status: 404 });

  const attachment = await getTeamTaskAttachment(companyId, attachmentId);
  if (!attachment || attachment.taskId !== task.id) {
    return new NextResponse('Not found', { status: 404 });
  }

  const url = await createSignedTeamTaskAttachmentUrl(attachment.storagePath, 3600, {
    download: attachment.originalFileName,
  });
  if (!url) {
    return new NextResponse(
      'Attachment storage is not configured. Contact your administrator.',
      { status: 503 },
    );
  }

  return NextResponse.redirect(url);
}
