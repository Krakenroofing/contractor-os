// Posting periods (roadmap Priority 2). Monthly, per company; no row means
// OPEN. The hard enforcement is in database triggers (see migration
// 2026-09-26_accounting_periods.sql) so every write path is covered; this
// module manages close / reopen, the audit log, the close-time GL
// snapshot, and friendly pre-checks for the busiest actions.

import 'server-only';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  accountingPeriodLog,
  accountingPeriods,
  type AccountingPeriod,
  type AccountingPeriodLogEntry,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

/** 'YYYY-MM-DD' (or Date) → 'YYYY-MM-01'. */
export function monthStartOf(d: string | Date): string {
  const iso = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  return `${iso.slice(0, 7)}-01`;
}

export function monthLabel(monthStart: string): string {
  const [y, m] = monthStart.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function addMonths(monthStart: string, n: number): string {
  const [y, m] = monthStart.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

// ----- Errors raised by the triggers -----

/** True for the trigger's "Closed period: …" error (SQLSTATE KP001). */
export function isPeriodClosedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; cause?: unknown };
  if (e.code === 'KP001') return true;
  if (typeof e.message === 'string' && e.message.startsWith('Closed period:')) {
    return true;
  }
  return e.cause ? isPeriodClosedError(e.cause) : false;
}

/** The trigger's human message, or null when the error is something else. */
export function periodClosedMessage(err: unknown): string | null {
  if (!isPeriodClosedError(err)) return null;
  let e: unknown = err;
  while (e && typeof e === 'object') {
    const m = (e as { message?: string }).message;
    if (typeof m === 'string' && m.startsWith('Closed period:')) return m;
    e = (e as { cause?: unknown }).cause;
  }
  return 'Closed period: this change falls in a period that is closed for posting.';
}

// ----- Reads -----

export async function listAccountingPeriods(
  companyId: string,
): Promise<AccountingPeriod[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return db
    .select()
    .from(accountingPeriods)
    .where(eq(accountingPeriods.companyId, companyId))
    .orderBy(asc(accountingPeriods.periodStart));
}

export async function listClosedMonths(companyId: string): Promise<Set<string>> {
  const rows = await listAccountingPeriods(companyId);
  return new Set(
    rows.filter((r) => r.status === 'closed').map((r) => String(r.periodStart)),
  );
}

export async function listPeriodLog(
  companyId: string,
  limit = 50,
): Promise<AccountingPeriodLogEntry[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return db
    .select()
    .from(accountingPeriodLog)
    .where(eq(accountingPeriodLog.companyId, companyId))
    .orderBy(desc(accountingPeriodLog.createdAt))
    .limit(limit);
}

/**
 * Friendly pre-check for actions: null when every date is in an open
 * period, else the same message the trigger would raise.
 */
export async function closedPeriodMessageFor(
  companyId: string,
  dates: Array<string | Date | null | undefined>,
  what: string,
): Promise<string | null> {
  const real = dates.filter((d): d is string | Date => Boolean(d));
  if (real.length === 0) return null;
  const closed = await listClosedMonths(companyId);
  if (closed.size === 0) return null;
  for (const d of real) {
    const iso = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
    const ms = monthStartOf(iso);
    if (closed.has(ms)) {
      const label = monthLabel(ms);
      return `Closed period: ${what} is dated ${iso}, and ${label} is closed for posting. Post the correction in an open period, or ask the owner to reopen ${label}.`;
    }
  }
  return null;
}

/**
 * Months the Periods page lists: from the company's first dated activity
 * (GL or job cost; ignoring typo'd years before 2000) through the current
 * month, plus any stored period outside that span.
 */
export async function listPeriodRange(companyId: string): Promise<string[]> {
  const current = monthStartOf(new Date());
  if (!isDatabaseConfigured()) return [current];
  const db = getDb()!;
  const [row] = (await db.execute(sql`
    SELECT LEAST(
      (SELECT MIN(entry_date) FROM journal_entries
        WHERE company_id = ${companyId} AND entry_date >= DATE '2000-01-01'),
      (SELECT MIN(entry_date) FROM job_cost_entries
        WHERE company_id = ${companyId} AND entry_date >= DATE '2000-01-01'
          AND deleted_at IS NULL)
    ) AS first_date
  `)) as unknown as Array<{ first_date: string | Date | null }>;
  const first = row?.first_date
    ? monthStartOf(
        row.first_date instanceof Date
          ? row.first_date.toISOString()
          : String(row.first_date),
      )
    : addMonths(current, -11);
  const months: string[] = [];
  for (let m = first; m <= current; m = addMonths(m, 1)) months.push(m);
  const stored = await listAccountingPeriods(companyId);
  for (const p of stored) {
    const ms = String(p.periodStart);
    if (!months.includes(ms)) months.push(ms);
  }
  return months.sort();
}

// ----- GL snapshot / integrity -----

type Totals = Record<string, [number, number]>;

/** Per-month, per-account debit/credit totals from the live GL. */
export async function glTotalsByMonth(
  companyId: string,
  months: string[],
): Promise<Map<string, Totals>> {
  const out = new Map<string, Totals>();
  if (!isDatabaseConfigured() || months.length === 0) return out;
  const db = getDb()!;
  const lo = months.reduce((a, b) => (a < b ? a : b));
  const hi = addMonths(months.reduce((a, b) => (a > b ? a : b)), 1);
  const rows = (await db.execute(sql`
    SELECT to_char(date_trunc('month', je.entry_date), 'YYYY-MM-DD') AS month,
           jl.account_id AS account_id,
           COALESCE(SUM(jl.debit), 0)::float8 AS debit,
           COALESCE(SUM(jl.credit), 0)::float8 AS credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.company_id = ${companyId}
      AND je.entry_date >= ${lo}::date AND je.entry_date < ${hi}::date
    GROUP BY 1, 2
  `)) as unknown as Array<{
    month: string;
    account_id: string;
    debit: number;
    credit: number;
  }>;
  const wanted = new Set(months);
  for (const r of rows) {
    if (!wanted.has(r.month)) continue;
    const t = out.get(r.month) ?? {};
    t[r.account_id] = [
      Math.round(Number(r.debit) * 100) / 100,
      Math.round(Number(r.credit) * 100) / 100,
    ];
    out.set(r.month, t);
  }
  for (const m of months) if (!out.has(m)) out.set(m, {});
  return out;
}

export type PeriodDrift = {
  accountId: string;
  closedDebit: number;
  closedCredit: number;
  nowDebit: number;
  nowCredit: number;
};

/** Compare each closed month's snapshot against the live GL. */
export async function closedPeriodDrift(
  companyId: string,
): Promise<Map<string, PeriodDrift[]>> {
  const periods = (await listAccountingPeriods(companyId)).filter(
    (p) => p.status === 'closed',
  );
  const result = new Map<string, PeriodDrift[]>();
  if (periods.length === 0) return result;
  const live = await glTotalsByMonth(
    companyId,
    periods.map((p) => String(p.periodStart)),
  );
  for (const p of periods) {
    const month = String(p.periodStart);
    const snap = (p.glSnapshot ?? {}) as Totals;
    const now = live.get(month) ?? {};
    const ids = new Set([...Object.keys(snap), ...Object.keys(now)]);
    const drift: PeriodDrift[] = [];
    for (const id of ids) {
      const [cd, cc] = snap[id] ?? [0, 0];
      const [nd, nc] = now[id] ?? [0, 0];
      if (Math.abs(cd - nd) > 0.005 || Math.abs(cc - nc) > 0.005) {
        drift.push({
          accountId: id,
          closedDebit: cd,
          closedCredit: cc,
          nowDebit: nd,
          nowCredit: nc,
        });
      }
    }
    result.set(month, drift);
  }
  return result;
}

// ----- Writes -----

/**
 * Close every OPEN month from the company's first listed month through
 * `throughMonth`, snapshotting each month's GL. Months are closed in
 * order so the books close the way accountants do: no open gaps behind a
 * closed month.
 */
export async function closePeriodsThrough(
  companyId: string,
  throughMonth: string,
  user: { id: string | null; name: string | null },
): Promise<{ closed: string[] }> {
  const db = getDb()!;
  const target = monthStartOf(throughMonth);
  const current = monthStartOf(new Date());
  if (target >= current) {
    throw new Error(
      `${monthLabel(current)} is still in progress — you can close through ${monthLabel(addMonths(current, -1))} at the latest.`,
    );
  }
  const range = (await listPeriodRange(companyId)).filter((m) => m <= target);
  const closedAlready = await listClosedMonths(companyId);
  const toClose = range.filter((m) => !closedAlready.has(m));
  if (toClose.length === 0) return { closed: [] };
  const snapshots = await glTotalsByMonth(companyId, toClose);
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const m of toClose) {
      await tx
        .insert(accountingPeriods)
        .values({
          companyId,
          periodStart: m,
          status: 'closed',
          closedAt: now,
          closedByUserId: user.id,
          glSnapshot: snapshots.get(m) ?? {},
        })
        .onConflictDoUpdate({
          target: [accountingPeriods.companyId, accountingPeriods.periodStart],
          set: {
            status: 'closed',
            closedAt: now,
            closedByUserId: user.id,
            glSnapshot: snapshots.get(m) ?? {},
            updatedAt: now,
          },
        });
      await tx.insert(accountingPeriodLog).values({
        companyId,
        periodStart: m,
        action: 'closed',
        userId: user.id,
        userName: user.name,
      });
    }
  });
  return { closed: toClose };
}

export async function reopenPeriod(
  companyId: string,
  month: string,
  user: { id: string | null; name: string | null },
  reason: string,
): Promise<void> {
  const db = getDb()!;
  const ms = monthStartOf(month);
  const now = new Date();
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(accountingPeriods)
      .set({
        status: 'open',
        closedAt: null,
        closedByUserId: null,
        glSnapshot: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(accountingPeriods.companyId, companyId),
          eq(accountingPeriods.periodStart, ms),
          eq(accountingPeriods.status, 'closed'),
        ),
      )
      .returning({ id: accountingPeriods.id });
    if (rows.length === 0) throw new Error(`${monthLabel(ms)} is not closed.`);
    await tx.insert(accountingPeriodLog).values({
      companyId,
      periodStart: ms,
      action: 'reopened',
      userId: user.id,
      userName: user.name,
      reason,
    });
  });
}
