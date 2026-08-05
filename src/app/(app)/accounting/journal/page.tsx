import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listJournalEntries } from '@/lib/data/general-ledger';
import { ReverseEntryButton } from '@/modules/accounting/components/reverse-entry-button';
import { RebuildGlButton } from '@/modules/accounting/components/rebuild-gl-button';

export const dynamic = 'force-dynamic';

export default async function JournalPage() {
  const role = await getActiveRole();
  // The GL journal is a financial surface — gate it on chart-of-accounts
  // visibility, not the general reports permission that PMs also hold.
  if (!canView(role, 'accounting_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const canEdit = canCreate(role, 'settings');

  const entries = await listJournalEntries(company.id, 100);

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            General Ledger
          </h1>
          <p className="text-sm text-slate-500">
            Double-entry journal. Every financial event becomes a balanced
            entry here; the Trial Balance and statements read from it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && <RebuildGlButton />}
          <Link href={{ pathname: '/reports/balance-sheet' }}>
            <Button variant="outline">Balance Sheet</Button>
          </Link>
          <Link href={{ pathname: '/reports/trial-balance' }}>
            <Button variant="outline">Trial Balance</Button>
          </Link>
          <Link href={{ pathname: '/reports/cash-flow' }}>
            <Button variant="outline">Cash Flow</Button>
          </Link>
          <Link href={{ pathname: '/reports/general-ledger' }}>
            <Button variant="outline">GL Detail</Button>
          </Link>
          {canEdit && (
            <Link href={{ pathname: '/accounting/journal/new' }}>
              <Button>New entry</Button>
            </Link>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-slate-500">
            No journal entries yet. Post opening balances or an adjustment with
            “New entry”. Auto-posting from invoices, payments, and bank
            transactions arrives in the next phase.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => {
            const totalDebit = e.lines.reduce((s, l) => s + Number(l.debit), 0);
            const reversed = !!e.reversedByEntryId;
            const isReversal = !!e.reversesEntryId;
            return (
              <Card key={e.id} className={reversed ? 'opacity-60' : undefined}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-mono text-slate-500">
                        {e.entryDate}
                      </span>{' '}
                      <span className="text-slate-800">
                        {e.memo ?? '(no memo)'}
                      </span>
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                        {e.sourceType}
                      </span>
                      {reversed && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-700">
                          reversed
                        </span>
                      )}
                      {isReversal && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                          reversal
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium tabular-nums text-slate-700">
                        {formatMoney(totalDebit)}
                      </span>
                      {canEdit && !reversed && !isReversal && (
                        <ReverseEntryButton entryId={e.id} />
                      )}
                    </div>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {e.lines.map((l) => (
                        <tr key={l.id}>
                          <td className="py-0.5 text-slate-700">
                            {l.accountCode ? (
                              <span className="font-mono text-slate-400">
                                {l.accountCode}{' '}
                              </span>
                            ) : null}
                            {l.accountName}
                            {l.description ? (
                              <span className="ml-2 text-slate-400">
                                {l.description}
                              </span>
                            ) : null}
                          </td>
                          <td className="w-28 py-0.5 text-right tabular-nums text-slate-700">
                            {Number(l.debit) !== 0 ? formatMoney(l.debit) : ''}
                          </td>
                          <td className="w-28 py-0.5 text-right tabular-nums text-slate-700">
                            {Number(l.credit) !== 0 ? formatMoney(l.credit) : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
