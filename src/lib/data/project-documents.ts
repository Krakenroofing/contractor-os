// Async data accessor for project documents.
//
// Phase 1 ships:
//   - project_documents CRUD scoped by company_id + project_id
//   - soft-delete with best-effort storage blob cleanup
//
// Demo mode: this module deliberately does NOT have a mock-store fallback
// (matches the daily-reports pattern). When DATABASE_URL is missing, the
// action layer surfaces a clear error instead.

import 'server-only';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  projectDocuments,
  type ProjectDocument,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { deleteProjectDocumentBlob } from '@/lib/storage/project-documents';

export class ProjectDocumentsNotAvailableInDemoError extends Error {
  constructor() {
    super(
      'Project Documents require a configured database. Set DATABASE_URL and apply the project_documents migration to use this module.',
    );
    this.name = 'ProjectDocumentsNotAvailableInDemoError';
  }
}

function requireDb() {
  if (!isDatabaseConfigured()) {
    throw new ProjectDocumentsNotAvailableInDemoError();
  }
  return getDb()!;
}

export type CreateProjectDocumentInput = Omit<
  ProjectDocument,
  'id' | 'uploadedAt' | 'updatedAt' | 'deletedAt'
>;

export type UpdateProjectDocumentInput = Partial<
  Pick<
    ProjectDocument,
    'fileName' | 'category' | 'description' | 'visibleToClient' | 'sortOrder'
  >
>;

export async function listProjectDocuments(
  companyId: string,
  projectId: string,
): Promise<ProjectDocument[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(projectDocuments)
    .where(
      and(
        eq(projectDocuments.companyId, companyId),
        eq(projectDocuments.projectId, projectId),
        isNull(projectDocuments.deletedAt),
      ),
    )
    .orderBy(
      asc(projectDocuments.sortOrder),
      desc(projectDocuments.uploadedAt),
    );
}

export async function countProjectDocuments(
  companyId: string,
  projectId: string,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const db = getDb()!;
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(projectDocuments)
    .where(
      and(
        eq(projectDocuments.companyId, companyId),
        eq(projectDocuments.projectId, projectId),
        isNull(projectDocuments.deletedAt),
      ),
    );
  return rows[0]?.n ?? 0;
}

export async function getProjectDocument(
  companyId: string,
  id: string,
): Promise<ProjectDocument | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(projectDocuments)
    .where(
      and(
        eq(projectDocuments.id, id),
        eq(projectDocuments.companyId, companyId),
        isNull(projectDocuments.deletedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function createProjectDocument(
  input: CreateProjectDocumentInput,
): Promise<ProjectDocument> {
  const db = requireDb();
  const [row] = await db.insert(projectDocuments).values(input).returning();
  return row;
}

export async function updateProjectDocument(
  companyId: string,
  id: string,
  patch: UpdateProjectDocumentInput,
): Promise<ProjectDocument | undefined> {
  const db = requireDb();
  const rows = await db
    .update(projectDocuments)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(projectDocuments.id, id),
        eq(projectDocuments.companyId, companyId),
        isNull(projectDocuments.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

export async function softDeleteProjectDocument(
  companyId: string,
  id: string,
): Promise<ProjectDocument | undefined> {
  const db = requireDb();
  const existing = await getProjectDocument(companyId, id);
  if (!existing) return undefined;
  const now = new Date();
  const rows = await db
    .update(projectDocuments)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(projectDocuments.id, id),
        eq(projectDocuments.companyId, companyId),
        isNull(projectDocuments.deletedAt),
      ),
    )
    .returning();
  if (!rows[0]) return undefined;
  // Best-effort blob cleanup. Soft-delete keeps the DB row for audit/recovery
  // but the blob behind it can go. If storage delete fails, the DB row is
  // already marked deleted — orphaned blobs are harmless (just cost storage).
  try {
    await deleteProjectDocumentBlob(existing.storagePath);
  } catch {
    // swallow — see comment above
  }
  return rows[0];
}
