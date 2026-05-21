// Dual-backend data accessor for frozen paystubs. Locking a period
// writes the full batch atomically (delete-then-insert in the
// Postgres path, replace-array in mock). Unlocking deletes the batch.

import 'server-only';
import { and, eq } from 'drizzle-orm';
import {
  periodPaystubSnapshots,
  type PeriodPaystubSnapshot,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockPaystubSnapshots as mockList,
  replaceMockPaystubSnapshotsForPeriod as mockReplace,
  deleteMockPaystubSnapshotsForPeriod as mockDelete,
  type CreateSnapshotInput,
} from '@/lib/mock-store';

export type { CreateSnapshotInput };

export async function listPaystubSnapshots(
  companyId: string,
  filters: { payPeriodId?: string } = {},
): Promise<PeriodPaystubSnapshot[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const conds = [eq(periodPaystubSnapshots.companyId, companyId)];
    if (filters.payPeriodId) {
      conds.push(eq(periodPaystubSnapshots.payPeriodId, filters.payPeriodId));
    }
    return await db
      .select()
      .from(periodPaystubSnapshots)
      .where(and(...conds));
  }
  return mockList(companyId, filters);
}

/**
 * Replace the entire snapshot set for one period. Used by lockPeriodAction:
 * compute all paystubs live, then call this in one shot. The whole batch
 * lands atomically so a partial write can never leave a period
 * half-snapshotted.
 */
export async function replacePaystubSnapshotsForPeriod(
  companyId: string,
  payPeriodId: string,
  inputs: CreateSnapshotInput[],
): Promise<PeriodPaystubSnapshot[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db.transaction(async (tx) => {
      // Drop the old set (if any) before inserting the new one — keeps
      // the unique (pay_period_id, employee_id) index honest.
      await tx
        .delete(periodPaystubSnapshots)
        .where(
          and(
            eq(periodPaystubSnapshots.companyId, companyId),
            eq(periodPaystubSnapshots.payPeriodId, payPeriodId),
          ),
        );
      if (inputs.length === 0) return [];
      return await tx
        .insert(periodPaystubSnapshots)
        .values(inputs.map((i) => ({ ...i, companyId })))
        .returning();
    });
  }
  return mockReplace(companyId, payPeriodId, inputs);
}

/** Drop the snapshot set when a period is unlocked. */
export async function deletePaystubSnapshotsForPeriod(
  companyId: string,
  payPeriodId: string,
): Promise<number> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .delete(periodPaystubSnapshots)
      .where(
        and(
          eq(periodPaystubSnapshots.companyId, companyId),
          eq(periodPaystubSnapshots.payPeriodId, payPeriodId),
        ),
      )
      .returning();
    return rows.length;
  }
  return mockDelete(companyId, payPeriodId);
}
