import 'server-only';
import {
  listTeamTasks,
  listAttachmentsForTasks,
  listRepliesForTasks,
} from '@/lib/data/team-tasks';

export type TeamTaskAttachmentView = {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
};

export type TeamTaskReplyView = {
  id: string;
  createdById: string | null;
  createdByName: string;
  createdAtISO: string;
  body: string;
};

export type TeamTaskView = {
  id: string;
  body: string;
  status: 'open' | 'done';
  createdById: string | null;
  createdByName: string;
  createdAtISO: string;
  resolvedByName: string | null;
  resolvedAtISO: string | null;
  attachments: TeamTaskAttachmentView[];
  replies: TeamTaskReplyView[];
};

/**
 * Build the dashboard inbox view: all open tasks (newest first) plus a capped
 * tail of recently-resolved ones, each with its attachments attached. One
 * batched attachment query for the whole set.
 */
export async function buildTeamTasks(companyId: string): Promise<{
  tasks: TeamTaskView[];
  openCount: number;
}> {
  const tasks = await listTeamTasks(companyId, { includeDone: true, doneLimit: 8 });
  const ids = tasks.map((t) => t.id);
  const [attachments, replies] = await Promise.all([
    listAttachmentsForTasks(companyId, ids),
    listRepliesForTasks(companyId, ids),
  ]);

  const byTask = new Map<string, TeamTaskAttachmentView[]>();
  for (const a of attachments) {
    const list = byTask.get(a.taskId) ?? [];
    list.push({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      byteSize: a.byteSize,
    });
    byTask.set(a.taskId, list);
  }

  const repliesByTask = new Map<string, TeamTaskReplyView[]>();
  for (const r of replies) {
    const list = repliesByTask.get(r.taskId) ?? [];
    list.push({
      id: r.id,
      createdById: r.createdBy,
      createdByName: r.createdByName || 'Team member',
      createdAtISO: r.createdAt.toISOString(),
      body: r.body,
    });
    repliesByTask.set(r.taskId, list);
  }

  return {
    tasks: tasks.map((t) => ({
      id: t.id,
      body: t.body,
      status: t.status,
      createdById: t.createdBy,
      createdByName: t.createdByName || 'Team member',
      createdAtISO: t.createdAt.toISOString(),
      resolvedByName: t.resolvedByName,
      resolvedAtISO: t.resolvedAt ? t.resolvedAt.toISOString() : null,
      attachments: byTask.get(t.id) ?? [],
      replies: repliesByTask.get(t.id) ?? [],
    })),
    openCount: tasks.filter((t) => t.status === 'open').length,
  };
}
