import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { paymentMethods, type PaymentMethod } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export async function listPaymentMethods(
  companyId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<PaymentMethod[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return db
    .select()
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.companyId, companyId),
        opts.includeArchived ? undefined : eq(paymentMethods.isArchived, false),
      ),
    )
    .orderBy(asc(paymentMethods.name));
}

/** Case-insensitive find-or-create — "add as you go" from the pickers can't
 *  produce duplicates ("wire" and "Wire" are the same method). */
export async function findOrCreatePaymentMethod(
  companyId: string,
  name: string,
): Promise<PaymentMethod> {
  const db = getDb();
  if (!db) throw new Error('Payment methods require a configured database.');
  const trimmed = name.trim();
  const existing = await db
    .select()
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.companyId, companyId),
        sql`lower(${paymentMethods.name}) = lower(${trimmed})`,
      ),
    )
    .limit(1);
  if (existing[0]) {
    if (existing[0].isArchived) {
      const [row] = await db
        .update(paymentMethods)
        .set({ isArchived: false, updatedAt: new Date() })
        .where(eq(paymentMethods.id, existing[0].id))
        .returning();
      return row;
    }
    return existing[0];
  }
  const [row] = await db
    .insert(paymentMethods)
    .values({ companyId, name: trimmed })
    .returning();
  return row;
}
