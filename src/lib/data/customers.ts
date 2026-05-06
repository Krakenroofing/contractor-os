// Async data accessor for customers (dual-backend: Postgres or mock store).
// See src/lib/data/companies.ts for the high-level pattern.

import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { customers, type Customer } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockCustomers as mockList,
  getMockCustomer as mockGet,
  createMockCustomer as mockCreate,
  updateMockCustomer as mockUpdate,
  softDeleteMockCustomer as mockSoftDelete,
} from '@/lib/mock-store';

export type CreateCustomerInput = Omit<
  Customer,
  'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

export async function listCustomers(companyId: string): Promise<Customer[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(customers)
      .where(and(eq(customers.companyId, companyId), isNull(customers.deletedAt)))
      .orderBy(asc(customers.name));
  }
  return mockList(companyId);
}

export async function getCustomer(
  companyId: string,
  id: string,
): Promise<Customer | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.id, id),
          eq(customers.companyId, companyId),
          isNull(customers.deletedAt),
        ),
      )
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

export async function createCustomer(
  companyId: string,
  input: CreateCustomerInput,
): Promise<Customer> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .insert(customers)
      .values({ ...input, companyId })
      .returning();
    return rows[0];
  }
  return mockCreate(companyId, input);
}

export async function updateCustomer(
  companyId: string,
  id: string,
  patch: UpdateCustomerInput,
): Promise<Customer | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .update(customers)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(customers.id, id),
          eq(customers.companyId, companyId),
          isNull(customers.deletedAt),
        ),
      )
      .returning();
    return rows[0];
  }
  return mockUpdate(companyId, id, patch);
}

/**
 * Soft-delete a customer. The row is preserved (FK references like projects
 * keep working) but it stops appearing in lists / lookups. We deliberately
 * never hard-delete because customer history is referenced from projects,
 * estimates, and invoices.
 */
export async function softDeleteCustomer(
  companyId: string,
  id: string,
): Promise<Customer | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const now = new Date();
    const rows = await db
      .update(customers)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(customers.id, id),
          eq(customers.companyId, companyId),
          isNull(customers.deletedAt),
        ),
      )
      .returning();
    return rows[0];
  }
  return mockSoftDelete(companyId, id);
}
