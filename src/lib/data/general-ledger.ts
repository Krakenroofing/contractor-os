// Data layer for the double-entry general ledger (Phase 3). DB-only.

import 'server-only';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  accountingAccounts,
  journalEntries,
  journalLines,
  type JournalEntry,
  type JournalLine,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

const round2 = (n: number) => Math.round(n * 100) / 100;

export class UnbalancedJournalEntryError extends Error {
  constructor(totalDebit: number, totalCredit: number) {
    super(
      `Journal entry doesn't balance: debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)}.`,
    );
    this.name = 'UnbalancedJournalEntryError';
  }
}

export type JournalLineInput = {
  accountId: string;
  /** Use exactly one of debit/credit > 0 per line; the other 0. */
  debit: number;
  credit: number;
  projectId?: string | null;
  description?: string | null;
};

export type PostJournalEntryInput = {
  entryDate: string; // YYYY-MM-DD
  memo?: string | null;
  sourceType?: string;
  sourceId?: string | null;
  createdByUserId?: string | null;
  lines: JournalLineInput[];
};

/**
 * Post one balanced journal entry (header + lines) atomically. Validates that
 * total debits == total credits to the cent, every line is one-sided, and
 * there are at least two non-zero lines. Throws on imbalance — callers (event
 * posters) must construct balanced entries.
 */
export async function postJournalEntry(
  companyId: string,
  input: PostJournalEntryInput,
): Promise<{ id: string }> {
  if (!isDatabaseConfigured()) {
    throw new Error('General ledger requires a configured database.');
  }
  const lines = input.lines
    .map((l) => ({
      ...l,
      debit: round2(Math.max(0, Number(l.debit) || 0)),
      credit: round2(Math.max(0, Number(l.credit) || 0)),
    }))
    .filter((l) => l.debit > 0 || l.credit > 0);

  if (lines.length < 2) {
    throw new Error('A journal entry needs at least two lines.');
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of lines) {
    if (l.debit > 0 && l.credit > 0) {
      throw new Error('A line cannot have both a debit and a credit.');
    }
    totalDebit = round2(totalDebit + l.debit);
    totalCredit = round2(totalCredit + l.credit);
  }
  if (totalDebit === 0) throw new Error('A journal entry cannot be all zeros.');
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new UnbalancedJournalEntryError(totalDebit, totalCredit);
  }

  const db = getDb()!;
  return await db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(journalEntries)
      .values({
        companyId,
        entryDate: input.entryDate,
        memo: input.memo ?? null,
        sourceType: input.sourceType ?? 'manual',
        sourceId: input.sourceId ?? null,
        createdByUserId: input.createdByUserId ?? null,
      })
      .returning({ id: journalEntries.id });
    await tx.insert(journalLines).values(
      lines.map((l, i) => ({
        companyId,
        journalEntryId: entry.id,
        accountId: l.accountId,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
        projectId: l.projectId ?? null,
        description: l.description ?? null,
        sortOrder: i,
      })),
    );
    return { id: entry.id };
  });
}

/**
 * Reverse a posted entry by creating a mirror entry (debit<->credit) linked
 * both ways. Idempotent: a no-op if the entry is already reversed. We never
 * delete posted entries — corrections are always reversing entries.
 */
export async function reverseJournalEntry(
  companyId: string,
  entryId: string,
  opts: { entryDate: string; memo?: string | null; createdByUserId?: string | null },
): Promise<{ id: string } | null> {
  if (!isDatabaseConfigured()) return null;
  const db = getDb()!;
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(
      and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId)),
    )
    .limit(1);
  if (!entry || entry.reversedByEntryId) return null;
  const lines = await db
    .select()
    .from(journalLines)
    .where(eq(journalLines.journalEntryId, entryId));

  return await db.transaction(async (tx) => {
    const [rev] = await tx
      .insert(journalEntries)
      .values({
        companyId,
        entryDate: opts.entryDate,
        memo: opts.memo ?? `Reversal of ${entry.memo ?? 'entry'}`,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        reversesEntryId: entry.id,
        createdByUserId: opts.createdByUserId ?? null,
      })
      .returning({ id: journalEntries.id });
    await tx.insert(journalLines).values(
      lines.map((l, i) => ({
        companyId,
        journalEntryId: rev.id,
        accountId: l.accountId,
        // Swap debit/credit to reverse.
        debit: l.credit,
        credit: l.debit,
        projectId: l.projectId,
        description: l.description,
        sortOrder: i,
      })),
    );
    await tx
      .update(journalEntries)
      .set({ reversedByEntryId: rev.id, updatedAt: new Date() })
      .where(eq(journalEntries.id, entry.id));
    return { id: rev.id };
  });
}

/** Delete all auto-posted entries for a given source (so a re-post is clean).
 *  Only touches entries with a matching source_type + source_id. */
export async function deleteJournalEntriesForSource(
  companyId: string,
  sourceType: string,
  sourceId: string,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const db = getDb()!;
  const rows = await db
    .delete(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
      ),
    )
    .returning({ id: journalEntries.id });
  return rows.length;
}

export type TrialBalanceRow = {
  accountId: string;
  code: string | null;
  name: string;
  type: string;
  rollupGroup: string;
  debit: number;
  credit: number;
  /** debit − credit (positive = net debit balance). */
  balance: number;
};

export type TrialBalance = {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  /** Should be ~0 in a consistent ledger. */
  difference: number;
  asOf: string | null;
};

/**
 * Trial balance: each account's summed debits/credits (and net balance) from
 * the GL, optionally as of a date. Total debits should equal total credits.
 */
export async function getTrialBalance(
  companyId: string,
  asOf?: string | null,
): Promise<TrialBalance> {
  if (!isDatabaseConfigured()) {
    return { rows: [], totalDebit: 0, totalCredit: 0, difference: 0, asOf: asOf ?? null };
  }
  const db = getDb()!;
  const conds = [eq(journalLines.companyId, companyId)];
  if (asOf) conds.push(lte(journalEntries.entryDate, asOf));

  const rows = await db
    .select({
      accountId: accountingAccounts.id,
      code: accountingAccounts.code,
      name: accountingAccounts.name,
      type: accountingAccounts.type,
      rollupGroup: accountingAccounts.rollupGroup,
      debit: sql<string>`COALESCE(SUM(${journalLines.debit}), 0)`,
      credit: sql<string>`COALESCE(SUM(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      eq(journalEntries.id, journalLines.journalEntryId),
    )
    .innerJoin(
      accountingAccounts,
      eq(accountingAccounts.id, journalLines.accountId),
    )
    .where(and(...conds))
    .groupBy(
      accountingAccounts.id,
      accountingAccounts.code,
      accountingAccounts.name,
      accountingAccounts.type,
      accountingAccounts.rollupGroup,
    );

  let totalDebit = 0;
  let totalCredit = 0;
  const out: TrialBalanceRow[] = rows.map((r) => {
    const debit = round2(Number(r.debit));
    const credit = round2(Number(r.credit));
    totalDebit = round2(totalDebit + debit);
    totalCredit = round2(totalCredit + credit);
    return {
      accountId: r.accountId,
      code: r.code,
      name: r.name,
      type: r.type,
      rollupGroup: r.rollupGroup,
      debit,
      credit,
      balance: round2(debit - credit),
    };
  });
  out.sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name));

  return {
    rows: out,
    totalDebit,
    totalCredit,
    difference: round2(totalDebit - totalCredit),
    asOf: asOf ?? null,
  };
}

export type BalanceSheetLine = {
  accountId: string;
  name: string;
  amount: number;
};

export type BalanceSheet = {
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: BalanceSheetLine[];
  /** Current net income (income − cogs − opex) — folds into equity. */
  netIncome: number;
  totalAssets: number;
  totalLiabilities: number;
  /** Equity accounts + current net income. */
  totalEquity: number;
  /** assets − (liabilities + equity). ~0 in a consistent ledger. */
  difference: number;
  asOf: string | null;
};

/**
 * Balance Sheet derived from the GL trial balance: assets (debit-normal),
 * liabilities (credit-normal), equity (credit-normal) + current net income
 * (the P&L accounts rolled up). VAT Input is an asset, VAT Payable a
 * liability (split out of the vat_tax group by account type). Ties out because
 * the ledger's debits equal its credits.
 */
export async function buildBalanceSheet(
  companyId: string,
  asOf?: string | null,
): Promise<BalanceSheet> {
  const tb = await getTrialBalance(companyId, asOf);
  const assets: BalanceSheetLine[] = [];
  const liabilities: BalanceSheetLine[] = [];
  const equity: BalanceSheetLine[] = [];
  let income = 0;
  let expense = 0;

  for (const r of tb.rows) {
    const debitNormal = r.balance; // debit − credit
    const creditNormal = -r.balance; // credit − debit
    const line = (amount: number): BalanceSheetLine => ({
      accountId: r.accountId,
      name: r.name,
      amount,
    });
    const isAsset =
      r.rollupGroup === 'asset' ||
      (r.rollupGroup === 'vat_tax' && r.type === 'vat_input');
    const isLiability =
      r.rollupGroup === 'liability' ||
      (r.rollupGroup === 'vat_tax' && r.type !== 'vat_input');

    if (isAsset) {
      if (Math.abs(debitNormal) > 0.005) assets.push(line(debitNormal));
    } else if (isLiability) {
      if (Math.abs(creditNormal) > 0.005) liabilities.push(line(creditNormal));
    } else if (r.rollupGroup === 'equity') {
      if (Math.abs(creditNormal) > 0.005) equity.push(line(creditNormal));
    } else if (r.rollupGroup === 'income') {
      income = round2(income + creditNormal);
    } else if (r.rollupGroup === 'cogs' || r.rollupGroup === 'opex') {
      expense = round2(expense + debitNormal);
    }
  }

  const netIncome = round2(income - expense);
  const totalAssets = round2(assets.reduce((s, a) => s + a.amount, 0));
  const totalLiabilities = round2(
    liabilities.reduce((s, a) => s + a.amount, 0),
  );
  const totalEquity = round2(
    equity.reduce((s, a) => s + a.amount, 0) + netIncome,
  );
  return {
    assets,
    liabilities,
    equity,
    netIncome,
    totalAssets,
    totalLiabilities,
    totalEquity,
    difference: round2(totalAssets - (totalLiabilities + totalEquity)),
    asOf: asOf ?? null,
  };
}

export type JournalEntryWithLines = JournalEntry & {
  lines: Array<JournalLine & { accountName: string; accountCode: string | null }>;
};

/** Recent journal entries (headers + their lines + a debit total), newest
 *  first. For the journal list / verification view. */
export async function listJournalEntries(
  companyId: string,
  limit = 100,
): Promise<JournalEntryWithLines[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const entries = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.companyId, companyId))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
    .limit(limit);
  if (entries.length === 0) return [];

  const ids = entries.map((e) => e.id);
  const lines = await db
    .select({
      id: journalLines.id,
      companyId: journalLines.companyId,
      journalEntryId: journalLines.journalEntryId,
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      projectId: journalLines.projectId,
      description: journalLines.description,
      sortOrder: journalLines.sortOrder,
      accountName: accountingAccounts.name,
      accountCode: accountingAccounts.code,
    })
    .from(journalLines)
    .innerJoin(
      accountingAccounts,
      eq(accountingAccounts.id, journalLines.accountId),
    )
    .where(
      and(
        eq(journalLines.companyId, companyId),
        inArray(journalLines.journalEntryId, ids),
      ),
    );

  const byEntry = new Map<string, JournalEntryWithLines['lines']>();
  for (const l of lines) {
    const arr = byEntry.get(l.journalEntryId) ?? [];
    arr.push(l as JournalEntryWithLines['lines'][number]);
    byEntry.set(l.journalEntryId, arr);
  }
  return entries.map((e) => ({
    ...e,
    lines: (byEntry.get(e.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
  }));
}
