// Intercompany (roadmap P7).
//
// Each company names one intercompany account per partner — its net Due
// from / Due to position. Kraken's "Due from TRB" and TRB's "Due to Kraken"
// must always net to zero. A posting to one side gets a MIRROR entry in the
// other company: the partner's intercompany account on the opposite side,
// offset to the partner's Intercompany Clearing account (or an account the
// poster picks) for the partner's accountant to reclassify. The
// reconciliation pairs both sides — mirrors by their origin link, the rest
// by equal-and-opposite amount within ten days — and lists what's left.

import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { intercompanyAccounts, accountingAccounts, companies } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { insertAccountingAccount } from '@/lib/data/accounting-accounts';
import { postJournalEntry } from '@/lib/data/general-ledger';

export type IntercompanyLink = {
  companyId: string;
  partnerCompanyId: string;
  partnerName: string;
  accountId: string;
  accountName: string;
  accountType: string;
  clearingAccountId: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function listIntercompanyLinks(
  companyId: string,
): Promise<IntercompanyLink[]> {
  if (!isDatabaseConfigured()) return [];
  const rows = await getDb()!
    .select({
      companyId: intercompanyAccounts.companyId,
      partnerCompanyId: intercompanyAccounts.partnerCompanyId,
      partnerName: companies.name,
      accountId: intercompanyAccounts.accountId,
      accountName: accountingAccounts.name,
      accountType: accountingAccounts.type,
      clearingAccountId: intercompanyAccounts.clearingAccountId,
    })
    .from(intercompanyAccounts)
    .innerJoin(companies, eq(companies.id, intercompanyAccounts.partnerCompanyId))
    .innerJoin(
      accountingAccounts,
      eq(accountingAccounts.id, intercompanyAccounts.accountId),
    )
    .where(eq(intercompanyAccounts.companyId, companyId));
  return rows.map((r) => ({ ...r, accountType: String(r.accountType) }));
}

export async function getIntercompanyLink(
  companyId: string,
  partnerCompanyId: string,
): Promise<IntercompanyLink | null> {
  return (
    (await listIntercompanyLinks(companyId)).find(
      (l) => l.partnerCompanyId === partnerCompanyId,
    ) ?? null
  );
}

export async function upsertIntercompanyLink(input: {
  companyId: string;
  partnerCompanyId: string;
  accountId: string;
  clearingAccountId: string | null;
}): Promise<void> {
  await getDb()!
    .insert(intercompanyAccounts)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [intercompanyAccounts.companyId, intercompanyAccounts.partnerCompanyId],
      set: {
        accountId: input.accountId,
        clearingAccountId: input.clearingAccountId,
        updatedAt: new Date(),
      },
    });
}

/** The partner's clearing account for mirrored offsets — created on first
 *  use ("Intercompany Clearing — <origin company>", a balance-sheet account
 *  so nothing hits the P&L until it's reclassified). */
export async function ensureClearingAccount(link: IntercompanyLink): Promise<string> {
  if (link.clearingAccountId) return link.clearingAccountId;
  const db = getDb()!;
  const [origin] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, link.partnerCompanyId));
  const name = `Intercompany Clearing — ${origin?.name ?? 'partner'}`;
  const [existing] = await db
    .select({ id: accountingAccounts.id })
    .from(accountingAccounts)
    .where(
      and(
        eq(accountingAccounts.companyId, link.companyId),
        sql`lower(trim(${accountingAccounts.name})) = lower(${name})`,
      ),
    )
    .limit(1);
  const id =
    existing?.id ??
    (
      await insertAccountingAccount(link.companyId, {
        name,
        type: 'asset',
        rollupGroup: 'asset',
        parentId: null,
      })
    ).id;
  await upsertIntercompanyLink({
    companyId: link.companyId,
    partnerCompanyId: link.partnerCompanyId,
    accountId: link.accountId,
    clearingAccountId: id,
  });
  return id;
}

/**
 * Post the mirror of an intercompany posting in the partner company.
 * `originNet` is the origin's net DEBIT on its intercompany account; the
 * mirror credits (or debits) the partner's intercompany account by the same
 * amount and offsets it to `offsetAccountId` (default: clearing).
 */
export async function postIntercompanyMirror(input: {
  originCompanyId: string;
  originCompanyName: string;
  partnerLink: IntercompanyLink; // the PARTNER's link row (companyId = partner)
  originNet: number;
  entryDate: string;
  memo: string | null;
  originEntryId?: string | null;
  originSourceType?: string | null;
  originSourceId?: string | null;
  offsetAccountId?: string | null;
  createdByUserId: string | null;
}): Promise<{ id: string }> {
  const amount = round2(Math.abs(input.originNet));
  if (amount === 0) throw new Error('Nothing to mirror.');
  const offset = input.offsetAccountId ?? (await ensureClearingAccount(input.partnerLink));
  // Origin debited its IC account (it's owed more) → the partner owes more:
  // credit the partner's IC account, debit the offset. And vice versa.
  const originDebit = input.originNet > 0;
  return postJournalEntry(input.partnerLink.companyId, {
    entryDate: input.entryDate,
    memo: `Intercompany — mirror of ${input.originCompanyName}${input.memo ? `: ${input.memo}` : ''}`.slice(0, 1000),
    sourceType: 'manual',
    createdByUserId: input.createdByUserId,
    icOrigin: {
      companyId: input.originCompanyId,
      entryId: input.originEntryId ?? null,
      sourceType: input.originSourceType ?? null,
      sourceId: input.originSourceId ?? null,
    },
    lines: [
      {
        accountId: input.partnerLink.accountId,
        debit: originDebit ? 0 : amount,
        credit: originDebit ? amount : 0,
        description: `Mirror of ${input.originCompanyName}`,
      },
      {
        accountId: offset,
        debit: originDebit ? amount : 0,
        credit: originDebit ? 0 : amount,
        description: 'Intercompany offset — reclassify if needed',
      },
    ],
  });
}

/** Live mirror entries (not reversed) of one origin entry. */
export async function findMirrorEntries(
  originCompanyId: string,
  originEntryId: string,
): Promise<Array<{ id: string; companyId: string; entryDate: string }>> {
  if (!isDatabaseConfigured()) return [];
  const rows = await getDb()!.execute(sql`
    SELECT id, company_id, entry_date FROM journal_entries
     WHERE ic_origin_company_id = ${originCompanyId}
       AND ic_origin_entry_id = ${originEntryId}
       AND reversed_by_entry_id IS NULL AND reverses_entry_id IS NULL`);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    companyId: String(r.company_id),
    entryDate:
      r.entry_date instanceof Date
        ? r.entry_date.toISOString().slice(0, 10)
        : String(r.entry_date).slice(0, 10),
  }));
}

/** An entry's intercompany origin, when it is itself a mirror. */
export async function getEntryIcOrigin(
  companyId: string,
  entryId: string,
): Promise<{ originCompanyId: string; originEntryId: string } | null> {
  if (!isDatabaseConfigured()) return null;
  const rows = await getDb()!.execute(sql`
    SELECT ic_origin_company_id, ic_origin_entry_id FROM journal_entries
     WHERE id = ${entryId} AND company_id = ${companyId}`);
  const r = (rows as unknown as Array<Record<string, unknown>>)[0];
  if (!r?.ic_origin_company_id || !r.ic_origin_entry_id) return null;
  return {
    originCompanyId: String(r.ic_origin_company_id),
    originEntryId: String(r.ic_origin_entry_id),
  };
}

// ---------------- Reconciliation ----------------

export type IcItem = {
  side: 'mine' | 'partner';
  entryId: string;
  entryDate: string;
  memo: string | null;
  sourceType: string;
  sourceId: string | null;
  net: number; // debit − credit on that side's IC account
  isReversalPair: boolean;
  icOriginCompanyId: string | null;
  icOriginEntryId: string | null;
  icOriginSourceType: string | null;
  icOriginSourceId: string | null;
  matchedWith: string | null; // entry id on the other side
  matchKind: 'mirror' | 'amount' | 'reversal' | null;
};

async function sideItems(
  companyId: string,
  accountId: string,
  side: IcItem['side'],
): Promise<IcItem[]> {
  const rows = await getDb()!.execute(sql`
    SELECT je.id, je.entry_date, je.memo, je.source_type, je.source_id,
           je.reverses_entry_id, je.reversed_by_entry_id,
           je.ic_origin_company_id, je.ic_origin_entry_id,
           je.ic_origin_source_type, je.ic_origin_source_id,
           SUM(jl.debit - jl.credit)::float8 AS net
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE je.company_id = ${companyId} AND jl.account_id = ${accountId}
     GROUP BY je.id
    HAVING ABS(SUM(jl.debit - jl.credit)) > 0.004
     ORDER BY je.entry_date, je.created_at`);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    side,
    entryId: String(r.id),
    entryDate:
      r.entry_date instanceof Date
        ? r.entry_date.toISOString().slice(0, 10)
        : String(r.entry_date).slice(0, 10),
    memo: (r.memo as string | null) ?? null,
    sourceType: String(r.source_type),
    sourceId: (r.source_id as string | null) ?? null,
    net: round2(Number(r.net)),
    isReversalPair: Boolean(r.reverses_entry_id || r.reversed_by_entry_id),
    icOriginCompanyId: (r.ic_origin_company_id as string | null) ?? null,
    icOriginEntryId: (r.ic_origin_entry_id as string | null) ?? null,
    icOriginSourceType: (r.ic_origin_source_type as string | null) ?? null,
    icOriginSourceId: (r.ic_origin_source_id as string | null) ?? null,
    matchedWith: null,
    matchKind: null,
  }));
}

export type IntercompanyRecon = {
  link: IntercompanyLink;
  partnerLink: IntercompanyLink | null;
  myBalance: number;
  partnerBalance: number | null;
  difference: number | null;
  months: Array<{ month: string; mine: number; partner: number; diff: number }>;
  unmatchedMine: IcItem[];
  unmatchedPartner: IcItem[];
  matchedCount: number;
};

const dayDiff = (a: string, b: string) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;

export async function buildIntercompanyRecon(
  companyId: string,
  partnerCompanyId: string,
): Promise<IntercompanyRecon | null> {
  const link = await getIntercompanyLink(companyId, partnerCompanyId);
  if (!link) return null;
  const partnerLink = await getIntercompanyLink(partnerCompanyId, companyId);
  const mine = await sideItems(companyId, link.accountId, 'mine');
  const theirs = partnerLink
    ? await sideItems(partnerCompanyId, partnerLink.accountId, 'partner')
    : [];

  // 1. Reversal pairs cancel within their own side.
  for (const list of [mine, theirs]) {
    const byId = new Map(list.map((i) => [i.entryId, i]));
    for (const i of list) {
      if (i.matchKind) continue;
      const other = list.find(
        (o) =>
          o !== i &&
          !o.matchKind &&
          o.isReversalPair &&
          i.isReversalPair &&
          round2(o.net + i.net) === 0,
      );
      if (other && byId.has(other.entryId)) {
        i.matchKind = other.matchKind = 'reversal';
        i.matchedWith = other.entryId;
        other.matchedWith = i.entryId;
      }
    }
  }

  // 2. Mirrors, by their origin link.
  const link2 = (mirror: IcItem, originSide: IcItem[], originCompanyId: string) => {
    if (mirror.matchKind || mirror.icOriginCompanyId !== originCompanyId) return;
    const origin = originSide.find(
      (o) =>
        !o.matchKind &&
        ((mirror.icOriginEntryId && o.entryId === mirror.icOriginEntryId) ||
          (mirror.icOriginSourceId &&
            o.sourceType === mirror.icOriginSourceType &&
            o.sourceId === mirror.icOriginSourceId)),
    );
    if (origin && round2(origin.net + mirror.net) === 0) {
      origin.matchKind = mirror.matchKind = 'mirror';
      origin.matchedWith = mirror.entryId;
      mirror.matchedWith = origin.entryId;
    }
  };
  for (const t of theirs) link2(t, mine, companyId);
  for (const m of mine) link2(m, theirs, partnerCompanyId);

  // 3. Equal and opposite amounts within ten days, closest date first.
  for (const m of mine) {
    if (m.matchKind) continue;
    let best: IcItem | null = null;
    for (const t of theirs) {
      if (t.matchKind || round2(m.net + t.net) !== 0) continue;
      const dd = dayDiff(m.entryDate, t.entryDate);
      if (dd > 10) continue;
      if (!best || dd < dayDiff(m.entryDate, best.entryDate)) best = t;
    }
    if (best) {
      m.matchKind = best.matchKind = 'amount';
      m.matchedWith = best.entryId;
      best.matchedWith = m.entryId;
    }
  }

  const myBalance = round2(mine.reduce((s, i) => s + i.net, 0));
  const partnerBalance = partnerLink
    ? round2(theirs.reduce((s, i) => s + i.net, 0))
    : null;
  const monthMap = new Map<string, { mine: number; partner: number }>();
  for (const i of [...mine, ...theirs]) {
    const k = i.entryDate.slice(0, 7);
    const rec = monthMap.get(k) ?? { mine: 0, partner: 0 };
    if (i.side === 'mine') rec.mine = round2(rec.mine + i.net);
    else rec.partner = round2(rec.partner + i.net);
    monthMap.set(k, rec);
  }
  return {
    link,
    partnerLink,
    myBalance,
    partnerBalance,
    difference: partnerBalance === null ? null : round2(myBalance + partnerBalance),
    months: [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v, diff: round2(v.mine + v.partner) })),
    unmatchedMine: mine.filter((i) => !i.matchKind),
    unmatchedPartner: theirs.filter((i) => !i.matchKind),
    matchedCount:
      mine.filter((i) => i.matchKind && i.matchKind !== 'reversal').length,
  };
}
