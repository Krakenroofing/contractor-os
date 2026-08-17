// Lazy default Chart of Accounts seeder.
//
// Called the first time a company creates a bank account (or otherwise
// touches /banking). Idempotent: every account is upserted by (company_id, code).
//
// VAT accounts are only seeded when companies.is_vat_active is true, so US
// companies (Kraken) never see VAT Payable / VAT Input in their COA.

import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { accountingAccounts, type AccountingAccount } from '@/db/schema';
import type { Company } from '@/db/schema';

type SeedRow = {
  code: string;
  name: string;
  type: AccountingAccount['type'];
  rollupGroup: AccountingAccount['rollupGroup'];
};

function baseCoa(): SeedRow[] {
  return [
    { code: '4000', name: 'Sales / Income', type: 'income', rollupGroup: 'income' },
    { code: '4990', name: 'Uncategorized Income', type: 'uncategorized_income', rollupGroup: 'income' },
    { code: '5000', name: 'Cost of Goods Sold (Job Cost)', type: 'cogs_job_cost', rollupGroup: 'cogs' },
    { code: '6000', name: 'Operating Expense', type: 'expense', rollupGroup: 'opex' },
    { code: '6990', name: 'Uncategorized Expense', type: 'uncategorized_expense', rollupGroup: 'opex' },
    { code: '3000', name: "Owner's Equity", type: 'owner_equity', rollupGroup: 'equity' },
  ];
}

function vatCoa(): SeedRow[] {
  return [
    { code: '2200', name: 'VAT Payable', type: 'vat_payable', rollupGroup: 'vat_tax' },
    { code: '1300', name: 'VAT Input (Recoverable)', type: 'vat_input', rollupGroup: 'vat_tax' },
  ];
}

/**
 * Ensure the default COA exists for a company. Safe to call repeatedly; only
 * missing codes are inserted. Returns the full set of accounting accounts for
 * the company after seeding.
 */
export async function ensureDefaultCoaForCompany(
  company: Pick<Company, 'id' | 'defaultCurrency' | 'isVatActive'>,
): Promise<AccountingAccount[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const currency = company.defaultCurrency || 'USD';
  const wanted: SeedRow[] = company.isVatActive
    ? [...baseCoa(), ...vatCoa()]
    : baseCoa();

  // Read existing codes once, then insert any missing.
  const existing = await db
    .select()
    .from(accountingAccounts)
    .where(eq(accountingAccounts.companyId, company.id));
  const existingByCode = new Map(
    existing.filter((a) => a.code !== null).map((a) => [a.code!, a]),
  );

  const toInsert = wanted
    .filter((s) => !existingByCode.has(s.code))
    .map((s) => ({
      companyId: company.id,
      code: s.code,
      name: s.name,
      type: s.type,
      rollupGroup: s.rollupGroup,
      currency,
    }));
  if (toInsert.length > 0) {
    await db.insert(accountingAccounts).values(toInsert);
  }

  return await db
    .select()
    .from(accountingAccounts)
    .where(eq(accountingAccounts.companyId, company.id));
}

/**
 * Find-or-create the auto-paired accounting account for a new bank or credit
 * card. Each bank_account row needs a 1:1 accounting_accounts row of the
 * matching type — that pairing is the stable category target for future
 * posting. We do not assign a `code` to these auto-rows; users can name them
 * freely.
 */
/** Keep the paired chart-of-accounts entry in sync when a bank account is
 *  edited: name follows, and a bank↔credit-card type flip also flips the
 *  rollup (bank = asset, CC balance = liability). */
export async function updatePairedAccountingAccount(input: {
  companyId: string;
  accountingAccountId: string;
  name: string;
  type: 'bank' | 'credit_card';
  currency: string;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  await db
    .update(accountingAccounts)
    .set({
      name: input.name,
      type: input.type,
      rollupGroup: input.type === 'bank' ? 'asset' : 'liability',
      currency: input.currency,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(accountingAccounts.id, input.accountingAccountId),
        eq(accountingAccounts.companyId, input.companyId),
      ),
    );
}

export async function createPairedAccountingAccount(input: {
  companyId: string;
  name: string;
  type: 'bank' | 'credit_card';
  currency: string;
}): Promise<AccountingAccount> {
  if (!isDatabaseConfigured()) {
    throw new Error('Database not configured');
  }
  const db = getDb()!;
  const [row] = await db
    .insert(accountingAccounts)
    .values({
      companyId: input.companyId,
      code: null,
      name: input.name,
      type: input.type,
      // Bank accounts are an asset; credit-card balances are a liability.
      rollupGroup: input.type === 'bank' ? 'asset' : 'liability',
      currency: input.currency,
    })
    .returning();
  return row;
}

