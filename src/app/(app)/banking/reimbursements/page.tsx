import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canApproveReceipt, canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import {
  listPendingReimbursements,
  listPayouts,
  listLinesForPayout,
} from '@/lib/data/receipt-reimbursements';
import { listVendors } from '@/lib/data/vendors';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { listMembersForCompany } from '@/lib/data/memberships';
import { getUserNamesByIds } from '@/lib/data/users';
import { MarkPaidForm } from '@/modules/receipts/components/mark-paid-form';

export const dynamic = 'force-dynamic';

function firstString(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

export default async function ReimbursementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'receipts')) redirect('/banking' as never);
  const company = await getActiveCompany();
  const sp = await searchParams;
  const tab = firstString(sp.tab) === 'paid' ? 'paid' : 'pending';

  const canPayout = canApproveReceipt(role);

  if (tab === 'paid') {
    return <PaidTab companyId={company.id} canPayout={canPayout} />;
  }
  return <PendingTab companyId={company.id} canPayout={canPayout} />;
}

async function PendingTab({
  companyId,
  canPayout,
}: {
  companyId: string;
  canPayout: boolean;
}) {
  const [pending, members, vendors, bankAccounts] = await Promise.all([
    listPendingReimbursements(companyId),
    listMembersForCompany(companyId),
    listVendors(companyId),
    listBankAccounts(companyId),
  ]);

  const memberById = new Map(members.map((m) => [m.userId, m.name]));
  const vendorById = new Map(vendors.map((v) => [v.id, v.name]));

  // Group by paid_by_user_id. Currency is taken from the parent receipt of
  // the first line in the group — Phase 2.4 doesn't support mixed-currency
  // payouts and the data layer will reject them in createPayoutAndLinkLines.
  type Group = {
    userId: string;
    userName: string;
    currency: string;
    lines: typeof pending;
    total: number;
  };
  const groups = new Map<string, Group>();
  for (const row of pending) {
    const userId = row.line.paidByUserId!;
    let g = groups.get(userId);
    if (!g) {
      g = {
        userId,
        userName: memberById.get(userId) ?? 'Unknown user',
        currency: row.currency,
        lines: [],
        total: 0,
      };
      groups.set(userId, g);
    }
    g.lines.push(row);
    g.total += Number(row.line.total);
  }
  const groupList = Array.from(groups.values()).sort(
    (a, b) => b.total - a.total,
  );
  const grandTotal = groupList.reduce((s, g) => s + g.total, 0);

  return (
    <div className="p-6 space-y-6">
      <PageHeader tab="pending" grandTotal={grandTotal} />
      {groupList.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-600">
            No pending reimbursements. Submit or post a receipt with a
            reimbursable line and assign a payer to see it here.
          </CardContent>
        </Card>
      ) : (
        groupList.map((g) => (
          <Card key={g.userId}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>
                  {g.userName} — owed {formatMoney(g.total.toFixed(2), g.currency)}
                </span>
                <span className="text-xs font-normal text-slate-500">
                  {g.lines.length} line{g.lines.length === 1 ? '' : 's'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Receipt</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.lines.map((row) => (
                    <TableRow key={row.line.id}>
                      <TableCell className="text-xs font-mono">
                        {row.receiptDate}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.vendorId ? vendorById.get(row.vendorId) ?? '—' : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {row.line.description ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Link
                          href={{
                            pathname: `/banking/receipts/${row.receiptId}`,
                          }}
                          className="text-blue-700 hover:underline"
                        >
                          Open
                        </Link>
                        <span
                          className={
                            row.receiptStatus === 'posted'
                              ? 'ml-2 inline-block rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5'
                              : 'ml-2 inline-block rounded bg-blue-100 text-blue-800 px-1.5 py-0.5'
                          }
                        >
                          {row.receiptStatus}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.line.total, row.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {canPayout && (
                <MarkPaidForm
                  paidToUserId={g.userId}
                  paidToUserName={g.userName}
                  currency={g.currency}
                  lineIds={g.lines.map((l) => l.line.id)}
                  totalOwed={g.total}
                  bankAccounts={bankAccounts.map((b) => ({
                    id: b.id,
                    label: `${b.name} (${b.type === 'credit_card' ? 'CC' : 'Bank'})`,
                  }))}
                />
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

async function PaidTab({
  companyId,
  canPayout,
}: {
  companyId: string;
  canPayout: boolean;
}) {
  const payouts = await listPayouts(companyId, { limit: 200 });
  const userIds = Array.from(new Set(payouts.map((p) => p.paidToUserId)));
  const userNames = await getUserNamesByIds(userIds);
  const grandTotal = payouts.reduce((s, p) => s + Number(p.amount), 0);
  // Pull line counts per payout for display. Concurrent fetches are fine —
  // bounded by listPayouts.limit. For larger volumes we'd add a SQL count.
  const lineCounts = await Promise.all(
    payouts.map(async (p) => (await listLinesForPayout(companyId, p.id)).length),
  );

  return (
    <div className="p-6 space-y-6">
      <PageHeader tab="paid" grandTotal={grandTotal} />
      <Card>
        <CardHeader>
          <CardTitle>Recorded payouts</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {payouts.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-600">
              No payouts recorded yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paid on</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Via</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p, idx) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs font-mono">{p.paidAt}</TableCell>
                    <TableCell className="text-sm">
                      {userNames.get(p.paidToUserId) ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs">{p.paidVia}</TableCell>
                    <TableCell className="text-xs text-slate-700">
                      {p.reference ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {lineCounts[idx]}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(p.amount, p.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {!canPayout && (
        <p className="text-[11px] text-slate-500">
          Only owners or accounting can record payouts.
        </p>
      )}
    </div>
  );
}

function PageHeader({
  tab,
  grandTotal,
}: {
  tab: 'pending' | 'paid';
  grandTotal: number;
}) {
  return (
    <>
      <div>
        <Link
          href={{ pathname: '/banking' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Banking
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">
          Reimbursements
        </h1>
        <p className="text-sm text-slate-500">
          {tab === 'pending'
            ? 'Reimbursable receipt lines owed to staff. Submitted + posted receipts count.'
            : 'History of recorded payouts.'}
        </p>
      </div>
      <div className="flex items-center gap-4 border-b border-slate-200">
        <Link
          href={{ pathname: '/banking/reimbursements' }}
          className={
            tab === 'pending'
              ? 'pb-2 border-b-2 border-slate-900 text-sm font-medium text-slate-900'
              : 'pb-2 text-sm text-slate-500 hover:text-slate-900'
          }
        >
          Pending
        </Link>
        <Link
          href={{
            pathname: '/banking/reimbursements',
            query: { tab: 'paid' },
          }}
          className={
            tab === 'paid'
              ? 'pb-2 border-b-2 border-slate-900 text-sm font-medium text-slate-900'
              : 'pb-2 text-sm text-slate-500 hover:text-slate-900'
          }
        >
          Paid
        </Link>
        <span className="ml-auto pb-2 text-xs text-slate-500 tabular-nums">
          {tab === 'pending' ? 'Total owed: ' : 'Total paid: '}
          {grandTotal.toFixed(2)}
        </span>
      </div>
    </>
  );
}
