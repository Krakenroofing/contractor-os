// Data layer for timesheet lunch-break overrides. A row exists only when a
// day's lunch was edited away from the computed default. Demo mode (no
// DATABASE_URL) returns []/no-ops, matching the other payroll accessors.

import 'server-only';
import { and, eq } from 'drizzle-orm';
import {
  timesheetLunchOverrides,
  type TimesheetLunchOverride,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export async function listLunchOverrides(
  companyId: string,
  payPeriodId: string,
): Promise<TimesheetLunchOverride[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return db
    .select()
    .from(timesheetLunchOverrides)
    .where(
      and(
        eq(timesheetLunchOverrides.companyId, companyId),
        eq(timesheetLunchOverrides.payPeriodId, payPeriodId),
      ),
    );
}

/** Upsert a day's lunch minutes (one row per employee+date). */
export async function setLunchOverride(input: {
  companyId: string;
  employeeId: string;
  payPeriodId: string;
  workDate: string;
  minutes: number;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  await db
    .insert(timesheetLunchOverrides)
    .values(input)
    .onConflictDoUpdate({
      target: [
        timesheetLunchOverrides.employeeId,
        timesheetLunchOverrides.workDate,
      ],
      set: { minutes: input.minutes, updatedAt: new Date() },
    });
}

/** Remove a day's override so it reverts to the hours-based default. */
export async function clearLunchOverride(
  companyId: string,
  employeeId: string,
  workDate: string,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  await db
    .delete(timesheetLunchOverrides)
    .where(
      and(
        eq(timesheetLunchOverrides.companyId, companyId),
        eq(timesheetLunchOverrides.employeeId, employeeId),
        eq(timesheetLunchOverrides.workDate, workDate),
      ),
    );
}
