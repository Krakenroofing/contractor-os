// Async data accessor for team notes & tasks (the per-company admin inbox).
//
// Demo mode: like daily-reports / project-documents, this module has NO
// in-memory fallback. When DATABASE_URL is missing the action layer surfaces
// a clear error instead.

import 'server-only';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  teamTasks,
  teamTaskAttachments,
  type TeamTask,
  type TeamTaskAttachment,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { deleteTeamTaskAttachmentBlob } from '@/lib/storage/team-task-attachments';

export class TeamTasksNotAvailableInDemoError extends Error {
  constructor() {
    super(
      'Team Tasks require a configured database. Set DATABASE_URL and apply the team_tasks migration to use this feature.',
    );
    this.name = 'TeamTasksNotAvailableInDemoError';
  }
}

function requireDb() {
  if (!isDatabaseConfigured()) throw new TeamTasksNotAvailableInDemoError();
  return getDb()!;
}

export type CreateTeamTaskInput = {
  companyId: string;
  createdBy: string | null;
  createdByName: string;
  body: string;
};

export type CreateTeamTaskAttachmentInput = Omit<
  TeamTaskAttachment,
  'id' | 'createdAt'
>;

export async function listTeamTasks(
  companyId: string,
  opts: { includeDone?: boolean; doneLimit?: number } = {},
): Promise<TeamTask[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const rows = await db
    .select()
    .from(teamTasks)
    .where(
      and(
        eq(teamTasks.companyId, companyId),
        isNull(teamTasks.deletedAt),
        opts.includeDone ? undefined : eq(teamTasks.status, 'open'),
      ),
    )
    .orderBy(desc(teamTasks.createdAt));
  if (!opts.includeDone) return rows;
  // Open first (newest first), then a capped tail of recently-done tasks so
  // the admin can see what was just handled without an unbounded archive.
  const open = rows.filter((r) => r.status === 'open');
  const done = rows
    .filter((r) => r.status === 'done')
    .sort(
      (a, b) =>
        (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0),
    )
    .slice(0, opts.doneLimit ?? 10);
  return [...open, ...done];
}

export async function countOpenTeamTasks(companyId: string): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const db = getDb()!;
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(teamTasks)
    .where(
      and(
        eq(teamTasks.companyId, companyId),
        eq(teamTasks.status, 'open'),
        isNull(teamTasks.deletedAt),
      ),
    );
  return rows[0]?.n ?? 0;
}

export async function getTeamTask(
  companyId: string,
  id: string,
): Promise<TeamTask | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(teamTasks)
    .where(
      and(
        eq(teamTasks.id, id),
        eq(teamTasks.companyId, companyId),
        isNull(teamTasks.deletedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function listAttachmentsForTasks(
  companyId: string,
  taskIds: string[],
): Promise<TeamTaskAttachment[]> {
  if (!isDatabaseConfigured() || taskIds.length === 0) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(teamTaskAttachments)
    .where(
      and(
        eq(teamTaskAttachments.companyId, companyId),
        inArray(teamTaskAttachments.taskId, taskIds),
      ),
    )
    .orderBy(desc(teamTaskAttachments.createdAt));
}

export async function getTeamTaskAttachment(
  companyId: string,
  id: string,
): Promise<TeamTaskAttachment | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(teamTaskAttachments)
    .where(
      and(
        eq(teamTaskAttachments.id, id),
        eq(teamTaskAttachments.companyId, companyId),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function createTeamTask(
  input: CreateTeamTaskInput,
): Promise<TeamTask> {
  const db = requireDb();
  const [row] = await db
    .insert(teamTasks)
    .values({
      companyId: input.companyId,
      createdBy: input.createdBy,
      createdByName: input.createdByName,
      body: input.body,
    })
    .returning();
  return row;
}

export async function createTeamTaskAttachment(
  input: CreateTeamTaskAttachmentInput,
): Promise<TeamTaskAttachment> {
  const db = requireDb();
  const [row] = await db
    .insert(teamTaskAttachments)
    .values(input)
    .returning();
  return row;
}

export async function resolveTeamTask(
  companyId: string,
  id: string,
  resolver: { id: string | null; name: string },
): Promise<TeamTask | undefined> {
  const db = requireDb();
  const now = new Date();
  const rows = await db
    .update(teamTasks)
    .set({
      status: 'done',
      resolvedBy: resolver.id,
      resolvedByName: resolver.name,
      resolvedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(teamTasks.id, id),
        eq(teamTasks.companyId, companyId),
        isNull(teamTasks.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

export async function reopenTeamTask(
  companyId: string,
  id: string,
): Promise<TeamTask | undefined> {
  const db = requireDb();
  const now = new Date();
  const rows = await db
    .update(teamTasks)
    .set({
      status: 'open',
      resolvedBy: null,
      resolvedByName: null,
      resolvedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(teamTasks.id, id),
        eq(teamTasks.companyId, companyId),
        isNull(teamTasks.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

export async function softDeleteTeamTask(
  companyId: string,
  id: string,
): Promise<TeamTask | undefined> {
  const db = requireDb();
  const now = new Date();
  const rows = await db
    .update(teamTasks)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(teamTasks.id, id),
        eq(teamTasks.companyId, companyId),
        isNull(teamTasks.deletedAt),
      ),
    )
    .returning();
  if (!rows[0]) return undefined;
  // Best-effort blob cleanup for any attachments behind this task. The rows
  // cascade-delete with the task; the blobs we remove here so they don't
  // orphan in storage.
  const attachments = await listAttachmentsForTasks(companyId, [id]);
  for (const a of attachments) {
    try {
      await deleteTeamTaskAttachmentBlob(a.storagePath);
    } catch {
      /* best-effort */
    }
  }
  return rows[0];
}
