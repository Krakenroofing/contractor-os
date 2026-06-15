// Phase 1 operational accounting: seed the contractor-focused category list
// for a company. Idempotent — skips names already present, so callers can
// re-run safely to pick up additions to this file.
//
// Structure: section-header accounts (Income, COGS, OpEx, plus the
// balance-sheet groups Assets, Liabilities, Equity) seeded as parent rows,
// then the operational lines hung underneath each via parent_id. VAT-Tax
// isn't seeded here — it stays as rollup_group tags on the VAT accounts the
// VAT module auto-creates. The system "Owner's Equity" account (type
// owner_equity, seeded by the banking COA) is left untouched; our Equity
// header is a separate, operator-managed bucket.

import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { accountingAccounts, type NewAccountingAccount } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

type RollupGroup = 'income' | 'cogs' | 'opex' | 'asset' | 'liability' | 'equity' | 'vat_tax';

// AccountingAccountType from the existing enum; we use these specific
// values for seed rows so existing reports / filters keep working. The
// generic asset/liability/equity types back the balance-sheet categories.
type LegacyType =
  | 'income'
  | 'expense'
  | 'cogs_job_cost'
  | 'uncategorized_income'
  | 'uncategorized_expense'
  | 'asset'
  | 'liability'
  | 'equity';

type CategoryDef = {
  name: string;
  rollupGroup: RollupGroup;
  type: LegacyType;
  isHeader?: boolean;
};

// ---- Section headers ----
const HEADERS: CategoryDef[] = [
  { name: 'Income', rollupGroup: 'income', type: 'income', isHeader: true },
  { name: 'Cost of Goods Sold', rollupGroup: 'cogs', type: 'cogs_job_cost', isHeader: true },
  { name: 'Operating Expense', rollupGroup: 'opex', type: 'expense', isHeader: true },
  { name: 'Assets', rollupGroup: 'asset', type: 'asset', isHeader: true },
  { name: 'Liabilities', rollupGroup: 'liability', type: 'liability', isHeader: true },
  { name: 'Equity', rollupGroup: 'equity', type: 'equity', isHeader: true },
];

// ---- Operational lines (parent name → child names) ----
const CHILDREN: Record<string, { name: string; type: LegacyType }[]> = {
  Income: [
    { name: 'Roofing Revenue', type: 'income' },
    { name: 'Waterproofing Revenue', type: 'income' },
    { name: 'Windows & Doors Revenue', type: 'income' },
    { name: 'Service Revenue', type: 'income' },
    { name: 'Consulting Revenue', type: 'income' },
    { name: 'Change Order Revenue', type: 'income' },
  ],
  'Cost of Goods Sold': [
    { name: 'Roofing Materials', type: 'cogs_job_cost' },
    { name: 'Waterproofing Materials', type: 'cogs_job_cost' },
    { name: 'Windows & Doors Materials', type: 'cogs_job_cost' },
    { name: 'Direct Labor', type: 'cogs_job_cost' },
    { name: 'Labor Burden', type: 'cogs_job_cost' },
    { name: 'Expat Housing', type: 'cogs_job_cost' },
    { name: 'Per Diem', type: 'cogs_job_cost' },
    { name: 'Travel', type: 'cogs_job_cost' },
    { name: 'Fuel', type: 'cogs_job_cost' },
    { name: 'Freight', type: 'cogs_job_cost' },
    { name: 'Flat Rack Shipping', type: 'cogs_job_cost' },
    { name: 'Customs Duty', type: 'cogs_job_cost' },
    { name: 'VAT on Imports', type: 'cogs_job_cost' },
    { name: 'Equipment Rental', type: 'cogs_job_cost' },
    { name: 'Owned Equipment Allocation', type: 'cogs_job_cost' },
    { name: 'Crane Rental', type: 'cogs_job_cost' },
    { name: 'Temporary Protection', type: 'cogs_job_cost' },
    { name: 'Mobilization', type: 'cogs_job_cost' },
    { name: 'Disposal', type: 'cogs_job_cost' },
    { name: 'Permits', type: 'cogs_job_cost' },
    { name: 'Safety Equipment', type: 'cogs_job_cost' },
    { name: 'Subcontractors', type: 'cogs_job_cost' },
    { name: 'General Conditions', type: 'cogs_job_cost' },
    { name: 'Consumables/Fasteners', type: 'cogs_job_cost' },
  ],
  'Operating Expense': [
    { name: 'Office Rent', type: 'expense' },
    { name: 'Software', type: 'expense' },
    { name: 'Insurance', type: 'expense' },
    { name: 'Accounting', type: 'expense' },
    { name: 'Legal', type: 'expense' },
    { name: 'Marketing', type: 'expense' },
    { name: 'Vehicle Expense', type: 'expense' },
    { name: 'Office Payroll', type: 'expense' },
    { name: 'Utilities', type: 'expense' },
    { name: 'Bank Fees', type: 'expense' },
    { name: 'Phone/Internet', type: 'expense' },
  ],
  Assets: [
    { name: 'Equipment / Fixed Assets', type: 'asset' },
    { name: 'Vehicles', type: 'asset' },
    { name: 'Retainage Receivable', type: 'asset' },
    { name: 'Security Deposits', type: 'asset' },
    { name: 'Employee Advances', type: 'asset' },
  ],
  Liabilities: [
    { name: 'Loan / Note Payable', type: 'liability' },
    { name: 'Line of Credit', type: 'liability' },
    { name: 'Credit Card Payable', type: 'liability' },
    { name: 'Retainage Payable', type: 'liability' },
  ],
  Equity: [
    { name: 'Owner Draw', type: 'equity' },
    { name: 'Owner Contribution', type: 'equity' },
  ],
};

export type SeedContractorCategoriesResult = {
  insertedHeaders: number;
  insertedChildren: number;
  skipped: number;
};

/**
 * Insert the contractor category structure for a company. Idempotent:
 * any account whose name already exists (case-insensitive) under the
 * appropriate rollup group is skipped, so re-running picks up only
 * new additions to this file.
 *
 * Returns counts so the UI can show "inserted X new categories".
 */
export async function seedContractorCategoriesForCompany(
  companyId: string,
): Promise<SeedContractorCategoriesResult> {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'Cannot seed contractor categories without a configured database.',
    );
  }
  const db = getDb()!;

  // Pull existing accounts once so we can dedupe by (name, rollup_group).
  // Name comparison is case-insensitive trimmed.
  const existing = await db
    .select()
    .from(accountingAccounts)
    .where(eq(accountingAccounts.companyId, companyId));
  const existingKeys = new Set(
    existing.map((a) => `${a.rollupGroup}::${a.name.trim().toLowerCase()}`),
  );

  function alreadyHas(name: string, group: RollupGroup): boolean {
    return existingKeys.has(`${group}::${name.trim().toLowerCase()}`);
  }

  let insertedHeaders = 0;
  let insertedChildren = 0;
  let skipped = 0;

  // Pass 1: insert section headers. Track the resulting parent IDs by
  // name so pass 2 can wire children.
  const parentIdByName = new Map<string, string>();
  for (const h of HEADERS) {
    if (alreadyHas(h.name, h.rollupGroup)) {
      // Header already exists — find its id so children can still parent under it.
      const found = existing.find(
        (a) =>
          a.rollupGroup === h.rollupGroup &&
          a.name.trim().toLowerCase() === h.name.trim().toLowerCase(),
      );
      if (found) parentIdByName.set(h.name, found.id);
      skipped += 1;
      continue;
    }
    const row: NewAccountingAccount = {
      companyId,
      name: h.name,
      type: h.type,
      rollupGroup: h.rollupGroup,
      currency: 'USD',
    };
    const inserted = await db
      .insert(accountingAccounts)
      .values(row)
      .returning({ id: accountingAccounts.id });
    parentIdByName.set(h.name, inserted[0].id);
    insertedHeaders += 1;
  }

  // Pass 2: insert child rows under each header.
  for (const [parentName, kids] of Object.entries(CHILDREN)) {
    const parentId = parentIdByName.get(parentName);
    if (!parentId) continue;
    const parentHeader = HEADERS.find((h) => h.name === parentName);
    if (!parentHeader) continue;

    const toInsert: NewAccountingAccount[] = [];
    for (const k of kids) {
      if (alreadyHas(k.name, parentHeader.rollupGroup)) {
        skipped += 1;
        continue;
      }
      toInsert.push({
        companyId,
        name: k.name,
        type: k.type,
        rollupGroup: parentHeader.rollupGroup,
        parentId,
        currency: 'USD',
      });
    }
    if (toInsert.length > 0) {
      await db.insert(accountingAccounts).values(toInsert);
      insertedChildren += toInsert.length;
    }
  }

  return { insertedHeaders, insertedChildren, skipped };
}

// Marker so `eq`/`and`/`inArray` are kept by the type checker even if a
// future refactor drops a use. Cheap and avoids dead-import warnings.
void and;
void inArray;
