// Data layer for banking_rules. DB-only — no mock-store fallback, matching
// the pattern in lib/data/statement-imports.ts.

import 'server-only';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { bankingRules, type BankingRule, type NewBankingRule } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export class BankingRulesNotAvailableInDemoError extends Error {
  constructor() {
    super(
      'Banking rules require a configured database. Set DATABASE_URL and apply the banking-rules-phase1 migration to use this module.',
    );
    this.name = 'BankingRulesNotAvailableInDemoError';
  }
}

function requireDb() {
  if (!isDatabaseConfigured()) {
    throw new BankingRulesNotAvailableInDemoError();
  }
  return getDb()!;
}

export async function listBankingRules(
  companyId: string,
  options: { includeDisabled?: boolean } = {},
): Promise<BankingRule[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const where = options.includeDisabled
    ? and(eq(bankingRules.companyId, companyId), isNull(bankingRules.deletedAt))
    : and(
        eq(bankingRules.companyId, companyId),
        isNull(bankingRules.deletedAt),
        eq(bankingRules.enabled, true),
      );
  return await db
    .select()
    .from(bankingRules)
    .where(where)
    .orderBy(asc(bankingRules.priority), asc(bankingRules.createdAt));
}

export async function getBankingRule(
  companyId: string,
  id: string,
): Promise<BankingRule | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(bankingRules)
    .where(
      and(
        eq(bankingRules.id, id),
        eq(bankingRules.companyId, companyId),
        isNull(bankingRules.deletedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function createBankingRule(
  input: NewBankingRule,
): Promise<BankingRule> {
  const db = requireDb();
  const [row] = await db.insert(bankingRules).values(input).returning();
  return row;
}

export async function updateBankingRule(
  companyId: string,
  id: string,
  patch: Partial<NewBankingRule>,
): Promise<BankingRule | undefined> {
  const db = requireDb();
  const [row] = await db
    .update(bankingRules)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(bankingRules.id, id),
        eq(bankingRules.companyId, companyId),
        isNull(bankingRules.deletedAt),
      ),
    )
    .returning();
  return row;
}

export async function softDeleteBankingRule(
  companyId: string,
  id: string,
): Promise<BankingRule | undefined> {
  const db = requireDb();
  const now = new Date();
  const [row] = await db
    .update(bankingRules)
    .set({ deletedAt: now, updatedAt: now, enabled: false })
    .where(
      and(
        eq(bankingRules.id, id),
        eq(bankingRules.companyId, companyId),
        isNull(bankingRules.deletedAt),
      ),
    )
    .returning();
  return row;
}

/** Atomically increment match_count + bump last_matched_at on a single rule.
 *  Used by the Apply action so the rule list reflects activity. */
export async function bumpMatchCount(
  companyId: string,
  id: string,
  delta = 1,
): Promise<void> {
  const db = requireDb();
  await db
    .update(bankingRules)
    .set({
      matchCount: sql`${bankingRules.matchCount} + ${delta}`,
      lastMatchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(bankingRules.id, id), eq(bankingRules.companyId, companyId)),
    );
}

/** Bulk priority update. Caller passes ordered [{id, priority}] pairs derived
 *  from the drag-and-drop result. Each row is updated independently inside a
 *  single transaction so a failure rolls back the whole reorder. */
export async function setRulePriorities(
  companyId: string,
  pairs: { id: string; priority: number }[],
): Promise<void> {
  if (pairs.length === 0) return;
  const db = requireDb();
  await db.transaction(async (tx) => {
    for (const p of pairs) {
      await tx
        .update(bankingRules)
        .set({ priority: p.priority, updatedAt: new Date() })
        .where(
          and(
            eq(bankingRules.id, p.id),
            eq(bankingRules.companyId, companyId),
            isNull(bankingRules.deletedAt),
          ),
        );
    }
  });
}
