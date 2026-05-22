// Dual-backend data accessor for per-employee, per-period paystub
// adjustments. Each row is a single line item (one deduction, one per
// diem entry, etc.) — multiple rows per (employee, period, type) are
// allowed so each line item carries its own description.

import 'server-only';
import { and, eq } from 'drizzle-orm';
import {
  paystubAdjustments,
  type PaystubAdjustment,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockPaystubAdjustments as mockList,
  createMockPaystubAdjustment as mockCreate,
  deleteMockPaystubAdjustment as mockDelete,
  type CreatePaystubAdjustmentInput,
} from '@/lib/mock-store';

export type { CreatePaystubAdjustmentInput };
export type PaystubAdjustmentFilters = {
  payPeriodId?: string;
  employeeId?: string;
};

export async function listPaystubAdjustments(
  companyId: string,
  filters: PaystubAdjustmentFilters = {},
): Promise<PaystubAdjustment[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const conds = [eq(paystubAdjustments.companyId, companyId)];
    if (filters.payPeriodId)
      conds.push(eq(paystubAdjustments.payPeriodId, filters.payPeriodId));
    if (filters.employeeId)
      conds.push(eq(paystubAdjustments.employeeId, filters.employeeId));
    return await db
      .select()
      .from(paystubAdjustments)
      .where(and(...conds));
  }
  return mockList(companyId, filters);
}

export async function createPaystubAdjustment(
  companyId: string,
  input: CreatePaystubAdjustmentInput,
): Promise<PaystubAdjustment> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .insert(paystubAdjustments)
      .values({
        companyId,
        employeeId: input.employeeId,
        payPeriodId: input.payPeriodId,
        type: input.type,
        amount: input.amount,
        description: input.description,
      })
      .returning();
    return rows[0];
  }
  return mockCreate(companyId, input);
}

export async function deletePaystubAdjustment(
  companyId: string,
  id: string,
): Promise<PaystubAdjustment | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .delete(paystubAdjustments)
      .where(
        and(
          eq(paystubAdjustments.companyId, companyId),
          eq(paystubAdjustments.id, id),
        ),
      )
      .returning();
    return rows[0];
  }
  return mockDelete(companyId, id);
}

export async function getPaystubAdjustment(
  companyId: string,
  id: string,
): Promise<PaystubAdjustment | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(paystubAdjustments)
      .where(
        and(
          eq(paystubAdjustments.companyId, companyId),
          eq(paystubAdjustments.id, id),
        ),
      )
      .limit(1);
    return rows[0];
  }
  return mockList(companyId).find((r) => r.id === id);
}
