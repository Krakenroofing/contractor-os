// Dual-backend data accessor for employees. Mirrors the vendor / customer
// shape: when Supabase env vars are set, query Postgres via drizzle;
// otherwise read/write the in-memory mock store.

import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { employees, type Employee } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockEmployees as mockList,
  getMockEmployee as mockGet,
  createMockEmployee as mockCreate,
  updateMockEmployee as mockUpdate,
  softDeleteMockEmployee as mockSoftDelete,
  type CreateEmployeeInput,
} from '@/lib/mock-store';

export type { CreateEmployeeInput };
export type UpdateEmployeeInput = Partial<CreateEmployeeInput>;

export async function listEmployees(companyId: string): Promise<Employee[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(employees)
      .where(and(eq(employees.companyId, companyId), isNull(employees.deletedAt)))
      .orderBy(asc(employees.lastName), asc(employees.firstName));
  }
  return mockList(companyId);
}

export async function getEmployee(
  companyId: string,
  id: string,
): Promise<Employee | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.id, id),
          eq(employees.companyId, companyId),
          isNull(employees.deletedAt),
        ),
      )
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

export async function createEmployee(
  companyId: string,
  input: CreateEmployeeInput,
): Promise<Employee> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .insert(employees)
      .values({ ...input, companyId })
      .returning();
    return rows[0];
  }
  return mockCreate(companyId, input);
}

export async function updateEmployee(
  companyId: string,
  id: string,
  patch: UpdateEmployeeInput,
): Promise<Employee | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .update(employees)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(employees.id, id),
          eq(employees.companyId, companyId),
          isNull(employees.deletedAt),
        ),
      )
      .returning();
    return rows[0];
  }
  return mockUpdate(companyId, id, patch);
}

/**
 * Soft-delete an employee. Time entries and paystubs reference the row, so
 * we never hard-delete — terminated workers stay reachable for historical
 * reporting (NIB year-end, audit trails) but drop out of the active list.
 */
export async function softDeleteEmployee(
  companyId: string,
  id: string,
): Promise<Employee | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const now = new Date();
    const rows = await db
      .update(employees)
      .set({ deletedAt: now, updatedAt: now, active: false })
      .where(
        and(
          eq(employees.id, id),
          eq(employees.companyId, companyId),
          isNull(employees.deletedAt),
        ),
      )
      .returning();
    return rows[0];
  }
  return mockSoftDelete(companyId, id);
}
