// Dual-backend data accessor for per-employee, per-period gross-pay
// overrides. Postgres write uses ON CONFLICT on the unique
// (employee_id, pay_period_id) index so saving an existing combo is
// atomic — no read-then-write race.

import 'server-only';
import { and, eq } from 'drizzle-orm';
import {
  periodPayOverrides,
  type PeriodPayOverride,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockPeriodPayOverrides as mockList,
  getMockPeriodPayOverride as mockGet,
  upsertMockPeriodPayOverride as mockUpsert,
  deleteMockPeriodPayOverride as mockDelete,
  type UpsertPeriodPayOverrideInput,
} from '@/lib/mock-store';

export type { UpsertPeriodPayOverrideInput };
export type PayOverrideFilters = {
  payPeriodId?: string;
  employeeId?: string;
};

export async function listPeriodPayOverrides(
  companyId: string,
  filters: PayOverrideFilters = {},
): Promise<PeriodPayOverride[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const conds = [eq(periodPayOverrides.companyId, companyId)];
    if (filters.payPeriodId)
      conds.push(eq(periodPayOverrides.payPeriodId, filters.payPeriodId));
    if (filters.employeeId)
      conds.push(eq(periodPayOverrides.employeeId, filters.employeeId));
    return await db
      .select()
      .from(periodPayOverrides)
      .where(and(...conds));
  }
  return mockList(companyId, filters);
}

export async function getPeriodPayOverride(
  companyId: string,
  employeeId: string,
  payPeriodId: string,
): Promise<PeriodPayOverride | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(periodPayOverrides)
      .where(
        and(
          eq(periodPayOverrides.companyId, companyId),
          eq(periodPayOverrides.employeeId, employeeId),
          eq(periodPayOverrides.payPeriodId, payPeriodId),
        ),
      )
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, employeeId, payPeriodId);
}

export async function upsertPeriodPayOverride(
  companyId: string,
  input: UpsertPeriodPayOverrideInput,
): Promise<PeriodPayOverride> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .insert(periodPayOverrides)
      .values({
        companyId,
        employeeId: input.employeeId,
        payPeriodId: input.payPeriodId,
        grossAmount: input.grossAmount,
        notes: input.notes,
      })
      .onConflictDoUpdate({
        target: [
          periodPayOverrides.employeeId,
          periodPayOverrides.payPeriodId,
        ],
        set: {
          grossAmount: input.grossAmount,
          notes: input.notes,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0];
  }
  return mockUpsert(companyId, input);
}

export async function deletePeriodPayOverride(
  companyId: string,
  employeeId: string,
  payPeriodId: string,
): Promise<PeriodPayOverride | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .delete(periodPayOverrides)
      .where(
        and(
          eq(periodPayOverrides.companyId, companyId),
          eq(periodPayOverrides.employeeId, employeeId),
          eq(periodPayOverrides.payPeriodId, payPeriodId),
        ),
      )
      .returning();
    return rows[0];
  }
  return mockDelete(companyId, employeeId, payPeriodId);
}
