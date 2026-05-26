import 'server-only';
import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { employees, users, type Employee } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { getCurrentUser } from '@/lib/auth';

/**
 * Resolve the employee record linked to the currently signed-in user.
 *
 * Used by the field app (/field/*) to know "which employee just logged in"
 * — needed for clock-in stamps, daily-report attribution, and
 * "today's assignments" lookups.
 *
 * Returns null when:
 *   - No user is signed in
 *   - The signed-in user has no employee link (office staff / admins)
 *   - The linked employee was deleted (FK is ON DELETE SET NULL)
 *   - The database isn't configured (local dev with no Supabase)
 *
 * Callers in the field app should redirect to a "Not linked to an
 * employee" screen rather than crashing — most office users don't have
 * a link and that's fine; they just can't use the field-side features.
 */
export const getActiveEmployee = cache(async function getActiveEmployee(): Promise<
  Employee | null
> {
  if (!isDatabaseConfigured()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const db = getDb()!;
  // Single round-trip: join users → employees on users.employee_id.
  const rows = await db
    .select({ employee: employees })
    .from(users)
    .innerJoin(employees, eq(users.employeeId, employees.id))
    .where(eq(users.id, user.id))
    .limit(1);
  return rows[0]?.employee ?? null;
});
