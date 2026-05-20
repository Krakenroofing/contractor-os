// Async data accessor for projects (dual-backend: Postgres or mock store).

import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { projects, type Project } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockProjects as mockList,
  getMockProject as mockGet,
  createMockProject as mockCreate,
  updateMockProject as mockUpdate,
  softDeleteMockProject as mockSoftDelete,
  setProjectVerifiedInMemory,
} from '@/lib/mock-store';

export type CreateProjectInput = Omit<
  Project,
  | 'id'
  | 'companyId'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'reconciliationVerifiedAt'
  | 'reconciliationVerifiedRole'
  | 'reconciliationVerifiedNote'
>;

export type UpdateProjectInput = Partial<CreateProjectInput>;

export type ProjectVerificationPatch = {
  verifiedAt: Date | null;
  verifiedRole: string | null;
  verifiedNote: string | null;
};

/**
 * Sets or clears the reconciliation-verified flag on a project.
 * Set patch.verifiedAt to a Date to mark verified; pass null to un-verify.
 */
export async function setProjectVerified(
  companyId: string,
  projectId: string,
  patch: ProjectVerificationPatch,
): Promise<Project | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .update(projects)
      .set({
        reconciliationVerifiedAt: patch.verifiedAt,
        reconciliationVerifiedRole: patch.verifiedRole,
        reconciliationVerifiedNote: patch.verifiedNote,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.companyId, companyId),
          isNull(projects.deletedAt),
        ),
      )
      .returning();
    return rows[0];
  }
  return setProjectVerifiedInMemory(companyId, projectId, patch);
}

export async function listProjects(companyId: string): Promise<Project[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(projects)
      .where(and(eq(projects.companyId, companyId), isNull(projects.deletedAt)))
      .orderBy(desc(projects.createdAt));
  }
  return mockList(companyId);
}

export async function getProject(
  companyId: string,
  id: string,
): Promise<Project | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, id),
          eq(projects.companyId, companyId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

export async function createProject(
  companyId: string,
  input: CreateProjectInput,
): Promise<Project> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .insert(projects)
      .values({ ...input, companyId })
      .returning();
    return rows[0];
  }
  return mockCreate(companyId, input);
}

export async function updateProject(
  companyId: string,
  id: string,
  patch: UpdateProjectInput,
): Promise<Project | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .update(projects)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(projects.id, id),
          eq(projects.companyId, companyId),
          isNull(projects.deletedAt),
        ),
      )
      .returning();
    return rows[0];
  }
  return mockUpdate(companyId, id, patch);
}

/**
 * Soft-delete a project. Status='lost' is the right end-of-lifecycle for a
 * project we abandoned chasing; soft-delete is for projects created in
 * error (typo, wrong company) that should disappear from lists. Estimates,
 * invoices, and POs FK'd to the project keep their reference for history.
 */
export async function softDeleteProject(
  companyId: string,
  id: string,
): Promise<Project | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const now = new Date();
    const rows = await db
      .update(projects)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(projects.id, id),
          eq(projects.companyId, companyId),
          isNull(projects.deletedAt),
        ),
      )
      .returning();
    return rows[0];
  }
  return mockSoftDelete(companyId, id);
}
