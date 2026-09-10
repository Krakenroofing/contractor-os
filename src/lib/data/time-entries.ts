// Dual-backend data accessor for time entries. One row = one employee's
// hours on one date, optionally tied to a project + cost code.

import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
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

/**
 * Time entries for one employee on one date of a given type ('hours' |
 * 'amount'). The inline timesheet editor uses this to decide whether a
 * cell is a single editable row (0 or 1) or a split it must hand off to
 * the day-detail view (>1 — we never silently merge allocations).
 */
export async function findDayTypeEntries(
  companyId: string,
  employeeId: string,
  workDate: string,
  entryType: 'hours' | 'amount',
): Promise<TimeEntry[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.workDate, workDate),
          eq(timeEntries.entryType, entryType),
        ),
      );
  }
  return mockList(companyId, { employeeId }).filter(
    (t) => t.workDate === workDate && t.entryType === entryType,
  );
}

/**
 * Posting a work order claims the crew's matching clocked hours: for
 * each (employee, work date) labor line, jobless time entries are linked
 * via work_order_id and flagged is_service_call. Linked hours stay OFF
 * payroll's job-cost posting (no project) — the work-order lane carries
 * the cost — and the timesheet shows the link instead of prompting.
 * Returns how many entries were linked.
 */
export async function linkTimeEntriesToWorkOrder(
  companyId: string,
  workOrderId: string,
  lines: Array<{ employeeId: string; workDate: string }>,
): Promise<number> {
  if (!isDatabaseConfigured() || lines.length === 0) return 0;
  const db = getDb()!;
  let linked = 0;
  for (const line of lines) {
    const rows = await db
      .update(timeEntries)
      .set({
        workOrderId,
        isServiceCall: true,
        isOverhead: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.employeeId, line.employeeId),
          eq(timeEntries.workDate, line.workDate),
          isNull(timeEntries.projectId),
          isNull(timeEntries.workOrderId),
        ),
      )
      .returning({ id: timeEntries.id });
    linked += rows.length;
  }
  return linked;
}

/** Unposting a work order releases its claimed hours. They stay flagged
 *  service-call so the timesheet keeps prompting for a WO match instead
 *  of reading as unassigned. */
export async function unlinkTimeEntriesFromWorkOrder(
  companyId: string,
  workOrderId: string,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const db = getDb()!;
  const rows = await db
    .update(timeEntries)
    .set({ workOrderId: null, updatedAt: new Date() })
    .where(
      and(
        eq(timeEntries.companyId, companyId),
        eq(timeEntries.workOrderId, workOrderId),
      ),
    )
    .returning({ id: timeEntries.id });
  return rows.length;
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
