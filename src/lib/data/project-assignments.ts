// Project-assignment data layer. DB-only — assignments are pointless in
// demo mode (no real employees on the in-memory store).

import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  projectAssignments,
  type ProjectAssignment,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export type CreateAssignmentInput = {
  companyId: string;
  projectId: string;
  employeeId: string;
  assignedDate: string; // 'YYYY-MM-DD'
  roleLabel: string | null;
  notes: string | null;
  createdBy: string | null;
};

/**
 * Today's (or any given date's) assignments for one employee. Used by
 * /field/jobs — the hottest read in the field app aside from clock state.
 */
export async function listAssignmentsForEmployeeDate(
  employeeId: string,
  date: string,
): Promise<ProjectAssignment[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(projectAssignments)
    .where(
      and(
        eq(projectAssignments.employeeId, employeeId),
        eq(projectAssignments.assignedDate, date),
      ),
    )
    .orderBy(asc(projectAssignments.createdAt));
}

/**
 * All assignments for a project, optionally filtered to a date range.
 * Used by the admin "Crew assignments" section on /projects/[id]. We
 * return ALL rows when no date bounds are given so the admin can scan a
 * full schedule.
 */
export async function listAssignmentsForProject(
  projectId: string,
): Promise<ProjectAssignment[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(projectAssignments)
    .where(eq(projectAssignments.projectId, projectId))
    .orderBy(asc(projectAssignments.assignedDate), asc(projectAssignments.createdAt));
}

/**
 * Bulk-load assignment counts per project for a single date — used by
 * the /field/jobs "you have N jobs today" surface, and to power the
 * home-screen card without N+1 queries.
 */
export async function countAssignmentsForEmployeesOnDate(
  employeeIds: string[],
  date: string,
): Promise<Map<string, number>> {
  if (!isDatabaseConfigured() || employeeIds.length === 0) return new Map();
  const db = getDb()!;
  const rows = await db
    .select()
    .from(projectAssignments)
    .where(
      and(
        inArray(projectAssignments.employeeId, employeeIds),
        eq(projectAssignments.assignedDate, date),
      ),
    );
  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.employeeId, (counts.get(r.employeeId) ?? 0) + 1);
  }
  return counts;
}

export async function createAssignment(
  input: CreateAssignmentInput,
): Promise<ProjectAssignment> {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'Assignments require a configured database. Set DATABASE_URL.',
    );
  }
  const db = getDb()!;
  const rows = await db
    .insert(projectAssignments)
    .values({
      companyId: input.companyId,
      projectId: input.projectId,
      employeeId: input.employeeId,
      assignedDate: input.assignedDate,
      roleLabel: input.roleLabel,
      notes: input.notes,
      createdBy: input.createdBy,
    })
    // On unique-conflict we silently no-op — the admin clicking "assign"
    // twice for the same (project, employee, date) shouldn't bomb out.
    .onConflictDoNothing({
      target: [
        projectAssignments.projectId,
        projectAssignments.employeeId,
        projectAssignments.assignedDate,
      ],
    })
    .returning();
  return rows[0];
}

export async function deleteAssignment(
  companyId: string,
  id: string,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  await db
    .delete(projectAssignments)
    .where(
      and(
        eq(projectAssignments.id, id),
        eq(projectAssignments.companyId, companyId),
      ),
    );
}
