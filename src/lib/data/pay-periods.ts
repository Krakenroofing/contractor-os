// Dual-backend data accessor for pay periods. Periods are weekly (Mon–Sun)
// and created on demand the first time someone enters time inside the week.

import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
import { payPeriods, type PayPeriod } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockPayPeriods as mockList,
  getMockPayPeriod as mockGet,
  getMockPayPeriodByStart as mockGetByStart,
  createMockPayPeriod as mockCreate,
  updateMockPayPeriod as mockUpdate,
  type CreatePayPeriodInput,
} from '@/lib/mock-store';
import { mondayOf, sundayOf } from '@/modules/payroll/lib/periods';

export type { CreatePayPeriodInput };

export async function listPayPeriods(companyId: string): Promise<PayPeriod[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(payPeriods)
      .where(eq(payPeriods.companyId, companyId))
      .orderBy(desc(payPeriods.startDate));
  }
  return mockList(companyId);
}

export async function getPayPeriod(
  companyId: string,
  id: string,
): Promise<PayPeriod | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(payPeriods)
      .where(and(eq(payPeriods.id, id), eq(payPeriods.companyId, companyId)))
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

async function getPayPeriodByStart(
  companyId: string,
  startDate: string,
): Promise<PayPeriod | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(payPeriods)
      .where(
        and(
          eq(payPeriods.companyId, companyId),
          eq(payPeriods.startDate, startDate),
        ),
      )
      .orderBy(asc(payPeriods.startDate))
      .limit(1);
    return rows[0];
  }
  return mockGetByStart(companyId, startDate);
}

/**
 * Find or create the pay period containing `date`. Weeks run Monday–Sunday.
 * Idempotent — the unique (company_id, start_date) index in Postgres
 * prevents races; in mock mode we look up first.
 */
export async function getOrCreatePeriodForDate(
  companyId: string,
  date: string,
): Promise<PayPeriod> {
  const startDate = mondayOf(date);
  const endDate = sundayOf(date);
  const existing = await getPayPeriodByStart(companyId, startDate);
  if (existing) return existing;

  if (isDatabaseConfigured()) {
    const db = getDb()!;
    // ON CONFLICT DO NOTHING then re-select handles the race where two
    // concurrent requests both miss the lookup. Drizzle exposes onConflict
    // via the .onConflictDoNothing() builder.
    await db
      .insert(payPeriods)
      .values({
        companyId,
        startDate,
        endDate,
        status: 'open',
        notes: null,
      })
      .onConflictDoNothing();
    const rows = await db
      .select()
      .from(payPeriods)
      .where(
        and(
          eq(payPeriods.companyId, companyId),
          eq(payPeriods.startDate, startDate),
        ),
      )
      .limit(1);
    return rows[0]!;
  }
  return mockCreate(companyId, {
    startDate,
    endDate,
    status: 'open',
    notes: null,
  });
}

export async function updatePayPeriod(
  companyId: string,
  id: string,
  patch: Partial<Omit<PayPeriod, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>>,
): Promise<PayPeriod | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .update(payPeriods)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(payPeriods.id, id), eq(payPeriods.companyId, companyId)))
      .returning();
    return rows[0];
  }
  return mockUpdate(companyId, id, patch);
}
