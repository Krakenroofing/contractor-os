// Dual-backend data accessor for time entries. One row = one employee's
// hours on one date, optionally tied to a project + cost code.

import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { timeEntries, type TimeEntry } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockTimeEntries as mockList,
  getMockTimeEntry as mockGet,
  createMockTimeEntry as mockCreate,
  updateMockTimeEntry as mockUpdate,
  deleteMockTimeEntry as mockDelete,
  type CreateTimeEntryInput,
} from '@/lib/mock-store';

export type { CreateTimeEntryInput };
export type TimeEntryFilters = {
  payPeriodId?: string;
  employeeId?: string;
  projectId?: string;
};

export async function listTimeEntries(
  companyId: string,
  filters: TimeEntryFilters = {},
): Promise<TimeEntry[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const conds = [eq(timeEntries.companyId, companyId)];
    if (filters.payPeriodId)
      conds.push(eq(timeEntries.payPeriodId, filters.payPeriodId));
    if (filters.employeeId)
      conds.push(eq(timeEntries.employeeId, filters.employeeId));
    if (filters.projectId)
      conds.push(eq(timeEntries.projectId, filters.projectId));
    return await db
      .select()
      .from(timeEntries)
      .where(and(...conds))
      .orderBy(asc(timeEntries.workDate), asc(timeEntries.createdAt));
  }
  return mockList(companyId, filters);
}

export async function getTimeEntry(
  companyId: string,
  id: string,
): Promise<TimeEntry | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)))
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

export async function createTimeEntry(
  companyId: string,
  input: CreateTimeEntryInput,
): Promise<TimeEntry> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .insert(timeEntries)
      .values({ ...input, companyId })
      .returning();
    return rows[0];
  }
  return mockCreate(companyId, input);
}

export async function updateTimeEntry(
  companyId: string,
  id: string,
  patch: Partial<
    Omit<TimeEntry, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>
  >,
): Promise<TimeEntry | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .update(timeEntries)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)))
      .returning();
    return rows[0];
  }
  return mockUpdate(companyId, id, patch);
}

export async function deleteTimeEntry(
  companyId: string,
  id: string,
): Promise<TimeEntry | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .delete(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)))
      .returning();
    return rows[0];
  }
  return mockDelete(companyId, id);
}
