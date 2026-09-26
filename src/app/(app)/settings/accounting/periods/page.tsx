import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { getUserNamesByIds } from '@/lib/data/users';
import {
  closedPeriodDrift,
  listAccountingPeriods,
  listPeriodLog,
  listPeriodRange,
  monthLabel,
} from '@/lib/data/accounting-periods';
import {
  ClosePeriodsForm,
  ReopenPeriodButton,
} from '@/modules/accounting/components/period-controls';

export const dynamic = 'force-dynamic';

export default async function AccountingPeriodsPage() {
  const role = await getActiveRole();
  if (!canView(role, 'settings') && role !== 'accounting') {
    redirect('/settings' as never);
  }
  const company = await getActiveCompany();
  const canClose = role === 'owner' || role === 'accounting';
  const canReopen = role === 'owner';

  const [months, periods, log, drift, accounts] = await Promise.all([
    listPeriodRange(company.id),
    listAccountingPeriods(company.id),
    listPeriodLog(company.id, 30),
    closedPeriodDrift(company.id),
    listAccountingAccounts(company.id),
  ]);
  const byMonth = new Map(periods.map((p) => [String(p.periodStart), p]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const closerNames = await getUserNamesByIds(
    periods.map((p) => p.closedByUserId).filter((x): x is string => Boolean(x)),
  );
  const current = new Date().toISOString().slice(0, 7) + '-01';
  const closable = months.filter((m) => m < current);
  const lastClosed = [...months].reverse().find((m) => byMonth.get(m)?.status === 'closed');

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/settings', label: 'Settings' },
          { href: '/settings/accounting', label: 'Accounting' },
          { label: 'Posting periods' },
        ]}
      />
      <Link href={'/settings/accounting' as never}>
        <Button variant="outline" size="sm">
          ← Back to Accounting settings
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Posting periods</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          <span className="font-medium text-slate-900">{company.name}</span>{' '}
          — once a month is closed, nothing dated in it can be posted, edited,
          deleted, or moved in or out: bills, invoices, payments, credit memos,
          bank lines and their categories and matches, journal entries, job
          costs, and payroll. Corrections go into an open period. Reviewing and
          reconciling closed statements still works. Only the owner can
          reopen, and every close and reopen is logged below.
        </p>
      </header>

      {canClose && closable.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <ClosePeriodsForm
              months={closable.map((m) => ({ value: m, label: monthLabel(m) }))}
              defaultMonth={closable[closable.length - 1]}
              lastClosedLabel={lastClosed ? monthLabel(lastClosed) : null}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Months</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">Month</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Closed</th>
                <th className="px-4 py-2">Integrity since close</th>
                <th className="px-4 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map((m) => {
                const p = byMonth.get(m);
                const closed = p?.status === 'closed';
                const diffs = drift.get(m) ?? [];
                return (
                  <tr key={m} className="border-b border-slate-100 align-top">
                    <td className="px-4 py-2 font-medium text-slate-900">
                      {monthLabel(m)}
                      {m === current && (
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          in progress
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {closed ? (
                        <span className="inline-block rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                          🔒 Closed
                        </span>
                      ) : (
                        <span className="inline-block rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
                          Open
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {closed && p?.closedAt
                        ? `${p.closedAt.toISOString().slice(0, 10)}${
                            p.closedByUserId && closerNames.get(p.closedByUserId)
                              ? ` · ${closerNames.get(p.closedByUserId)}`
                              : ''
                          }`
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {!closed ? (
                        <span className="text-slate-400">—</span>
                      ) : diffs.length === 0 ? (
                        <span className="text-emerald-700">✓ Unchanged</span>
                      ) : (
                        <details>
                          <summary className="cursor-pointer text-red-700">
                            ⚠ {diffs.length} account
                            {diffs.length === 1 ? '' : 's'} differ from the close
                          </summary>
                          <ul className="mt-1 space-y-0.5 text-slate-600">
                            {diffs.map((d) => (
                              <li key={d.accountId}>
                                {accountName.get(d.accountId) ?? 'Unknown account'}:{' '}
                                Dr {formatMoney(d.closedDebit)} / Cr{' '}
                                {formatMoney(d.closedCredit)} at close → now Dr{' '}
                                {formatMoney(d.nowDebit)} / Cr{' '}
                                {formatMoney(d.nowCredit)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {closed && canReopen && (
                        <ReopenPeriodButton month={m} label={monthLabel(m)} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Close / reopen log</CardTitle>
        </CardHeader>
        <CardContent className={log.length === 0 ? '' : 'p-0'}>
          {log.length === 0 ? (
            <p className="text-sm text-slate-500">No periods closed yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">When</th>
                  <th className="px-4 py-2">Month</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">By</th>
                  <th className="px-4 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="px-4 py-2 text-xs text-slate-600 whitespace-nowrap">
                      {l.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-4 py-2">{monthLabel(String(l.periodStart))}</td>
                    <td className="px-4 py-2">
                      {l.action === 'closed' ? (
                        <span className="text-slate-700">Closed</span>
                      ) : (
                        <span className="font-medium text-amber-700">Reopened</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">{l.userName ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-slate-600">{l.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
