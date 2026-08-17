'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate, canResolveTeamTask } from '@/lib/permissions';
import { getUserNamesByIds } from '@/lib/data/users';
import {
  createTeamTask,
  createTeamTaskAttachment,
  createTeamTaskReply,
  getTeamTask,
  getTeamTaskReply,
  resolveTeamTask,
  reopenTeamTask,
  softDeleteTeamTask,
  softDeleteTeamTaskReply,
  updateTeamTaskBody,
  updateTeamTaskReplyBody,
  TeamTasksNotAvailableInDemoError,
} from '@/lib/data/team-tasks';
import {
  TEAM_TASK_ATTACHMENTS_BUCKET,
  ALLOWED_TEAM_TASK_MIME,
  MAX_TEAM_TASK_BYTES,
  extForTeamTaskUpload,
} from '@/lib/storage/team-task-attachments';
import {
  createSignedUploadForBucket,
  removeStorageObject,
  statStorageObject,
} from '@/lib/storage/signed-upload';
import { createTeamTaskSchema } from './schema';

export type TeamTaskActionState = {
  formError?: string;
  ok?: boolean;
};

const idSchema = z.string().uuid('Missing or invalid id');

function bytesToMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/** Best display name for the poster — the DB users.name snapshot, falling back
 *  to email, then a generic label. Stored on the task so the inbox reads right
 *  even if the user is later removed. */
async function resolveDisplayName(
  userId: string,
  email: string | null,
): Promise<string> {
  const names = await getUserNamesByIds([userId]);
  const name = names.get(userId);
  return (name && name.trim()) || email || 'Team member';
}

// =============================================================================
// Direct-to-storage upload URLs. The browser PUTs each file straight to the
// team-task-attachments bucket (server-generated, companyId-prefixed path),
// then hands the path refs to createTeamTaskAction, which re-stats each blob
// (client metadata is never trusted).
// =============================================================================

const uploadUrlRequestsSchema = z
  .array(
    z.object({
      fileName: z.string().min(1).max(300),
      mimeType: z.string().min(1).max(100),
      byteSize: z.number().int().positive(),
    }),
  )
  .min(1)
  .max(20);

export type TeamTaskUploadUrlGrant = {
  fileName: string;
  storagePath?: string;
  signedUrl?: string;
  error?: string;
};

export type CreateTeamTaskUploadUrlsState = {
  formError?: string;
  uploads?: TeamTaskUploadUrlGrant[];
};

export async function createTeamTaskUploadUrlsAction(
  requests: unknown,
): Promise<CreateTeamTaskUploadUrlsState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'team_tasks')) {
    return { formError: 'You do not have permission to post team tasks.' };
  }
  const companyId = await getActiveCompanyId();
  const parsed = uploadUrlRequestsSchema.safeParse(requests);
  if (!parsed.success) return { formError: 'Invalid upload request.' };

  const uploads: TeamTaskUploadUrlGrant[] = [];
  for (const req of parsed.data) {
    const mime = req.mimeType.toLowerCase();
    if (!ALLOWED_TEAM_TASK_MIME.has(mime)) {
      uploads.push({
        fileName: req.fileName,
        error: `Unsupported file type (${req.mimeType}).`,
      });
      continue;
    }
    if (req.byteSize > MAX_TEAM_TASK_BYTES) {
      uploads.push({
        fileName: req.fileName,
        error: `Too large (${bytesToMb(req.byteSize)}MB — max ${Math.round(MAX_TEAM_TASK_BYTES / 1024 / 1024)}MB).`,
      });
      continue;
    }
    try {
      const grant = await createSignedUploadForBucket({
        bucket: TEAM_TASK_ATTACHMENTS_BUCKET,
        companyId,
        // Park under a "tasks" segment; the row gets its real taskId on
        // finalize. The companyId prefix is what the security check enforces.
        scopeSegments: ['tasks'],
        ext: extForTeamTaskUpload(req.fileName, mime),
      });
      if (!grant) {
        return {
          formError:
            'Attachment storage is not configured. Contact your administrator.',
        };
      }
      uploads.push({
        fileName: req.fileName,
        storagePath: grant.storagePath,
        signedUrl: grant.signedUrl,
      });
    } catch (err) {
      uploads.push({
        fileName: req.fileName,
        error: err instanceof Error ? err.message : 'Could not start upload.',
      });
    }
  }
  return { uploads };
}

const directUploadRefSchema = z.object({
  storagePath: z.string().min(1).max(500),
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(100),
  byteSize: z.number().int().nonnegative(),
});

function parseUploadRefs(formData: FormData): z.infer<typeof directUploadRefSchema>[] {
  const raw = formData.get('uploads');
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = z.array(directUploadRefSchema).max(20).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

// =============================================================================
// Create a task (note text and/or attachments). Requires at least one of the
// two. Attachments are already in storage (direct upload) — we verify each and
// link it to the new task row.
// =============================================================================

export async function createTeamTaskAction(
  _prev: TeamTaskActionState,
  formData: FormData,
): Promise<TeamTaskActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'team_tasks')) {
    return { formError: 'You do not have permission to post team tasks.' };
  }
  const companyId = await getActiveCompanyId();

  const meta = createTeamTaskSchema.safeParse({
    body: formData.get('body') ?? '',
  });
  if (!meta.success) {
    return { formError: 'Your note is too long. Trim it and try again.' };
  }
  const body = meta.data.body;
  const refs = parseUploadRefs(formData);

  if (body.trim() === '' && refs.length === 0) {
    return { formError: 'Write a note or attach a file (or both).' };
  }

  let task;
  try {
    const displayName = await resolveDisplayName(user.id, user.email);
    // Dev-demo guard: only stamp created_by when the user id exists in users.
    const known = await getUserNamesByIds([user.id]);
    task = await createTeamTask({
      companyId,
      createdBy: known.has(user.id) ? user.id : null,
      createdByName: displayName,
      body: body.trim(),
    });
  } catch (err) {
    if (err instanceof TeamTasksNotAvailableInDemoError) {
      return { formError: err.message };
    }
    return {
      formError: err instanceof Error ? err.message : 'Could not post the task.',
    };
  }

  const failures: string[] = [];
  for (const ref of refs) {
    if (!ref.storagePath.startsWith(`${companyId}/`)) {
      failures.push(`${ref.fileName}: invalid upload path.`);
      continue;
    }
    const stat = await statStorageObject(TEAM_TASK_ATTACHMENTS_BUCKET, ref.storagePath);
    if (!stat) {
      failures.push(`${ref.fileName}: upload not found — retry.`);
      continue;
    }
    if (stat.byteSize > MAX_TEAM_TASK_BYTES) {
      await removeStorageObject(TEAM_TASK_ATTACHMENTS_BUCKET, ref.storagePath);
      failures.push(`${ref.fileName}: too large (${bytesToMb(stat.byteSize)}MB).`);
      continue;
    }
    const mime = (
      stat.mimeType && stat.mimeType !== 'application/octet-stream'
        ? stat.mimeType
        : ref.mimeType
    ).toLowerCase();
    if (!ALLOWED_TEAM_TASK_MIME.has(mime)) {
      await removeStorageObject(TEAM_TASK_ATTACHMENTS_BUCKET, ref.storagePath);
      failures.push(`${ref.fileName}: unsupported file type (${mime}).`);
      continue;
    }
    try {
      await createTeamTaskAttachment({
        companyId,
        taskId: task.id,
        uploadedBy: user.id,
        fileName: ref.fileName,
        originalFileName: ref.fileName,
        storagePath: ref.storagePath,
        mimeType: mime,
        byteSize: stat.byteSize,
      });
    } catch (err) {
      failures.push(
        `${ref.fileName}: ${err instanceof Error ? err.message : 'failed to attach.'}`,
      );
    }
  }

  revalidatePath('/dashboard');

  if (failures.length > 0) {
    return {
      ok: true,
      formError: `Posted, but ${failures.length} attachment(s) failed: ${failures.join(' · ')}`,
    };
  }
  return { ok: true };
}

// =============================================================================
// Replies — the follow-up answer or discussion under a note (Olga's ask).
// Anyone who can post a note can reply; replying to a resolved note is fine
// (it stays done — reopen separately if it needs more work).
// =============================================================================

export async function replyToTeamTaskAction(
  taskId: string,
  _prev: TeamTaskActionState,
  formData: FormData,
): Promise<TeamTaskActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'team_tasks')) {
    return { formError: 'You do not have permission to reply.' };
  }
  if (!idSchema.safeParse(taskId).success) {
    return { formError: 'Missing or invalid task id.' };
  }
  const body = String(formData.get('body') ?? '').trim();
  if (body === '') return { formError: 'Write a reply first.' };
  if (body.length > 4000) {
    return { formError: 'Your reply is too long. Trim it and try again.' };
  }
  const companyId = await getActiveCompanyId();
  const task = await getTeamTask(companyId, taskId);
  if (!task) return { formError: 'Note not found.' };

  try {
    const displayName = await resolveDisplayName(user.id, user.email);
    // Same dev-demo guard as elsewhere: only stamp created_by when the user
    // id really exists (the synthetic demo id isn't in users).
    const known = await getUserNamesByIds([user.id]);
    await createTeamTaskReply({
      companyId,
      taskId,
      createdBy: known.has(user.id) ? user.id : null,
      createdByName: displayName,
      body,
    });
  } catch (err) {
    if (err instanceof TeamTasksNotAvailableInDemoError) {
      return { formError: err.message };
    }
    return {
      formError: err instanceof Error ? err.message : 'Could not post the reply.',
    };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function editTeamTaskReplyAction(
  replyId: string,
  _prev: TeamTaskActionState,
  formData: FormData,
): Promise<TeamTaskActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!idSchema.safeParse(replyId).success) {
    return { formError: 'Missing or invalid reply id.' };
  }
  const body = String(formData.get('body') ?? '').trim();
  if (body === '') return { formError: 'A reply cannot be empty — delete it instead.' };
  if (body.length > 4000) {
    return { formError: 'Your reply is too long. Trim it and try again.' };
  }
  const companyId = await getActiveCompanyId();
  const existing = await getTeamTaskReply(companyId, replyId);
  if (!existing) return { formError: 'Reply not found.' };

  // Mirrors delete: admins edit anything, others only their own.
  const isAdmin = canResolveTeamTask(role);
  const isOwn = existing.createdBy === user.id;
  if (!isAdmin && !isOwn) {
    return { formError: 'You can only edit replies you posted.' };
  }

  try {
    await updateTeamTaskReplyBody(companyId, replyId, body);
  } catch (err) {
    return {
      formError: err instanceof Error ? err.message : 'Could not save the edit.',
    };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function editTeamTaskAction(
  taskId: string,
  _prev: TeamTaskActionState,
  formData: FormData,
): Promise<TeamTaskActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!idSchema.safeParse(taskId).success) {
    return { formError: 'Missing or invalid task id.' };
  }
  const body = String(formData.get('body') ?? '').trim();
  if (body === '') {
    return { formError: 'A note cannot be empty — delete it instead.' };
  }
  if (body.length > 4000) {
    return { formError: 'Your note is too long. Trim it and try again.' };
  }
  const companyId = await getActiveCompanyId();
  const existing = await getTeamTask(companyId, taskId);
  if (!existing) return { formError: 'Note not found.' };

  const isAdmin = canResolveTeamTask(role);
  const isOwn = existing.createdBy === user.id;
  if (!isAdmin && !isOwn) {
    return { formError: 'You can only edit notes you posted.' };
  }

  try {
    await updateTeamTaskBody(companyId, taskId, body);
  } catch (err) {
    return {
      formError: err instanceof Error ? err.message : 'Could not save the edit.',
    };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function deleteTeamTaskReplyAction(
  replyId: string,
  _prev: TeamTaskActionState,
  _formData: FormData,
): Promise<TeamTaskActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!idSchema.safeParse(replyId).success) {
    return { formError: 'Missing or invalid reply id.' };
  }
  const companyId = await getActiveCompanyId();
  const existing = await getTeamTaskReply(companyId, replyId);
  if (!existing) return { formError: 'Reply not found.' };

  // Mirrors the note rule: admins remove anything, others only their own.
  const isAdmin = canResolveTeamTask(role);
  const isOwn = existing.createdBy === user.id;
  if (!isAdmin && !isOwn) {
    return { formError: 'You can only delete replies you posted.' };
  }

  try {
    await softDeleteTeamTaskReply(companyId, replyId);
  } catch (err) {
    return {
      formError: err instanceof Error ? err.message : 'Could not delete reply.',
    };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}

// =============================================================================
// Resolve / reopen / delete — admin actions on the shared inbox.
// =============================================================================

export async function resolveTeamTaskAction(
  taskId: string,
  _prev: TeamTaskActionState,
  _formData: FormData,
): Promise<TeamTaskActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canResolveTeamTask(role)) {
    return { formError: 'Only owners and accounting can mark tasks done.' };
  }
  if (!idSchema.safeParse(taskId).success) {
    return { formError: 'Missing or invalid task id.' };
  }
  const companyId = await getActiveCompanyId();
  try {
    const name = await resolveDisplayName(user.id, user.email);
    const out = await resolveTeamTask(companyId, taskId, { id: user.id, name });
    if (!out) return { formError: 'Task not found.' };
  } catch (err) {
    if (err instanceof TeamTasksNotAvailableInDemoError) {
      return { formError: err.message };
    }
    return { formError: err instanceof Error ? err.message : 'Could not update task.' };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function reopenTeamTaskAction(
  taskId: string,
  _prev: TeamTaskActionState,
  _formData: FormData,
): Promise<TeamTaskActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canResolveTeamTask(role)) {
    return { formError: 'Only owners and accounting can reopen tasks.' };
  }
  if (!idSchema.safeParse(taskId).success) {
    return { formError: 'Missing or invalid task id.' };
  }
  const companyId = await getActiveCompanyId();
  try {
    const out = await reopenTeamTask(companyId, taskId);
    if (!out) return { formError: 'Task not found.' };
  } catch (err) {
    return { formError: err instanceof Error ? err.message : 'Could not reopen task.' };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function deleteTeamTaskAction(
  taskId: string,
  _prev: TeamTaskActionState,
  _formData: FormData,
): Promise<TeamTaskActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!idSchema.safeParse(taskId).success) {
    return { formError: 'Missing or invalid task id.' };
  }
  const companyId = await getActiveCompanyId();
  const existing = await getTeamTask(companyId, taskId);
  if (!existing) return { formError: 'Task not found.' };

  // Admins can delete anything; otherwise only the original poster can remove
  // their own note.
  const isAdmin = canResolveTeamTask(role);
  const isOwnNote = existing.createdBy === user.id;
  if (!isAdmin && !isOwnNote) {
    return { formError: 'You can only delete notes you posted.' };
  }

  try {
    await softDeleteTeamTask(companyId, taskId);
  } catch (err) {
    if (err instanceof TeamTasksNotAvailableInDemoError) {
      return { formError: err.message };
    }
    return { formError: err instanceof Error ? err.message : 'Could not delete task.' };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}
