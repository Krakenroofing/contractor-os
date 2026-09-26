import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { listCompanies } from '@/lib/data/companies';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { visibleCompanyIds } from '@/lib/data/visible-companies';
import {
  buildIntercompanyRecon,
  listIntercompanyLinks,
  type IcItem,
} from '@/lib/data/intercompany';
import { canPostInPartner } from '@/modules/accounting/lib/intercompany-access';
import {
  IntercompanyLinkForm,
  MirrorItemButton,
} from '@/modules/accounting/components/intercompany-client';

export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Journal entry',
  bank: 'Bank line',
  invoice: 'Invoice',
  receipt: 'Bill',
  payment: 'Payment',
  goods_receipt: 'Goods receipt',
  payroll_bill: 'Payroll bill',
};

// Intercompany (roadmap P7): each company's intercompany account with the
// other, the two balances side by side (they must net to zero), month by
// month, and every posting that has no counterpart on the other side.
export default async function IntercompanyPage() {
  const role = await getActiveRole();
  if (role !== 'owner' && role !== 'accounting') redirect('/dashboard');
  const user = await requireAuth();
  const company = await getActiveCompany();
  const visible = new Set(await visibleCompanyIds());
  const partners = (await listCompanies()).filter(
    (c) => c.id !== company.id && visible.has(c.id),
  );
  const [links, accounts] = await Promise.all([
    listIntercompanyLinks(company.id),
    listAccountingAccounts(company.id),
  ]);
  const accountOptions = accounts
    .filter((a) => !a.isArchived && (a.rollupGroup === 'asset' || a.rollupGroup === 'liability'))
    .map((a) => ({ id: a.id, label: `${a.code ? `${a.code} ` : ''}${a.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const sections = await Promise.all(
    partners.map(async (p) => ({
      partner: p,
      link: links.find((l) => l.partnerCompanyId === p.id) ?? null,
      recon: await buildIntercompanyRecon(company.id, p.id),
      canMirror: await canPostInPartner(user.id, p.id),
    })),
  );

  const ItemRows = ({
    items,
    partnerId,
    partnerName,
    canMirror,
  }: {
    items: IcItem[];
    partnerId: string;
    partnerName: string;
    canMirror: boolean;
  }) => (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-slate-100">
        {items.map((i) => (
          <tr key={i.entryId}>
            <td className="py-1.5 pr-3 font-mono text-xs">{i.entryDate}</td>
            <td className="py-1.5 pr-3 text-xs text-slate-500">
              {i.icOriginCompanyId ? 'Mirror' : (SOURCE_LABEL[i.sourceType] ?? i.sourceType)}
            </td>
            <td className="py-1.5 pr-3">
              {i.side === 'mine' ? (
                <Link
                  href={`/accounting/journal?entry=${i.entryId}` as never}
                  className="text-blue-700 hover:underline"
                >
                  {i.memo ?? '(no memo)'}
                </Link>
              ) : (
                (i.memo ?? '(no memo)')
              )}
            </td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(i.net)}</td>
            <td className="py-1.5 text-right">
              {i.side === 'mine' && canMirror ? (
                <MirrorItemButton
                  partnerCompanyId={partnerId}
                  entryId={i.entryId}
                  partnerName={partnerName}
                />
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Intercompany</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          <span className="font-medium text-slate-900">{company.name}</span> —
          each company keeps one intercompany account per partner. The two
          balances must net to zero. Journal entries that touch it post their
          mirror in the other company automatically; anything posted on one
          side only (bank lines, bills, invoices) shows below until its
          counterpart exists — mirror it, or record the other side.
        </p>
      </header>

      {partners.length === 0 && (
        <p className="text-sm text-slate-500">No other company you have access to.</p>
      )}

      {sections.map(({ partner, link, recon, canMirror }) => (
        <div key={partner.id} className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{company.name} ↔ {partner.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {role === 'owner' && (
                <IntercompanyLinkForm
                  partnerCompanyId={partner.id}
                  partnerName={partner.name}
                  accounts={accountOptions}
                  accountId={link?.accountId ?? null}
                  clearingAccountId={link?.clearingAccountId ?? null}
                />
              )}
              {link && recon && (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded border border-slate-200 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">
                        {company.name} · {link.accountName}
                      </div>
                      <div className="mt-1 text-lg font-semibold tabular-nums">
                        {formatMoney(recon.myBalance)}
                      </div>
                      <div className="text-xs text-slate-500">debit balance</div>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">
                        {partner.name} ·{' '}
                        {recon.partnerLink?.accountName ?? 'not set up'}
                      </div>
                      <div className="mt-1 text-lg font-semibold tabular-nums">
                        {recon.partnerBalance === null ? '—' : formatMoney(recon.partnerBalance)}
                      </div>
                      <div className="text-xs text-slate-500">
                        debit balance
                        {recon.partnerLink &&
                        recon.partnerLink.accountType === 'asset' &&
                        link.accountType === 'asset'
                          ? ' · both sides are typed as assets — one should be a liability'
                          : ''}
                      </div>
                    </div>
                    <div
                      className={`rounded border p-3 ${
                        recon.difference === 0
                          ? 'border-emerald-200 bg-emerald-50'
                          : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <div className="text-xs uppercase tracking-wide text-slate-500">
                        Out of balance by
                      </div>
                      <div className="mt-1 text-lg font-semibold tabular-nums">
                        {recon.difference === null ? '—' : formatMoney(recon.difference)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {recon.matchedCount} posting
                        {recon.matchedCount === 1 ? '' : 's'} paired ·{' '}
                        {recon.unmatchedMine.length + recon.unmatchedPartner.length} not
                      </div>
                    </div>
                  </div>

                  {recon.months.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="py-1 pr-3">Month</th>
                            <th className="py-1 pr-3 text-right">{company.name}</th>
                            <th className="py-1 pr-3 text-right">{partner.name}</th>
                            <th className="py-1 text-right">Difference</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {recon.months.map((m) => (
                            <tr key={m.month}>
                              <td className="py-1 pr-3 font-mono text-xs">{m.month}</td>
                              <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(m.mine)}</td>
                              <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(m.partner)}</td>
                              <td
                                className={`py-1 text-right tabular-nums ${
                                  m.diff !== 0 ? 'font-medium text-red-700' : 'text-emerald-700'
                                }`}
                              >
                                {m.diff === 0 ? '✓' : formatMoney(m.diff)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {recon && recon.unmatchedMine.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Only in {company.name} ({recon.unmatchedMine.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ItemRows
                  items={recon.unmatchedMine}
                  partnerId={partner.id}
                  partnerName={partner.name}
                  canMirror={canMirror && Boolean(recon.partnerLink)}
                />
              </CardContent>
            </Card>
          )}
          {recon && recon.unmatchedPartner.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Only in {partner.name} ({recon.unmatchedPartner.length}) — switch to{' '}
                  {partner.name} to mirror these here
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ItemRows
                  items={recon.unmatchedPartner}
                  partnerId={partner.id}
                  partnerName={partner.name}
                  canMirror={false}
                />
              </CardContent>
            </Card>
          )}
        </div>
      ))}
    </div>
  );
}
