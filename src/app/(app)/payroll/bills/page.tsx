import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listPayrollBillsWithDetails } from '@/lib/data/payroll-bills';

export const dynamic = 'force-dynamic';

function money(v: string): string {
  return formatMoney(Number(v));
}

export default async function PayrollBillsPage() {
  const role = await getActiveRole();
  if (!canView(role, 'payroll')) {
    return (
      <div className="p-8">
        <p className="text-sm text-slate-600">
          You don&apos;t have access to payroll.
        </p>
      </div>
    );
  }
  const companyId = await getActiveCompanyId();
  const bills = await listPayrollBillsWithDetails(companyId);

  const open = bills.filter((b) => b.status === 'open');
  const openNet = open.reduce((s, b) => s + Number(b.net), 0);

  // Group by pay period (newest first — the list is already bill-date desc).
  const periods = new Map<string, typeof bills>();
  for (const b of bills) {
    const key = `${b.periodStart}|${b.periodEnd}`;
    const arr = periods.get(key) ?? [];
    arr.push(b);
    periods.set(key, arr);
  }

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <Breadcrumbs
        items={[{ href: '/payroll', label: 'Payroll' }, { label: 'Payroll bills' }]}
      />

      <div className="flex items-start justify-between gap-4">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">Payroll bills</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            One bill per employee per pay period — gross wages, NIB withheld and
            accrued, net pay owed. Open bills are settled by matching the bank
            withdrawal (&quot;Pay bills…&quot; on the bank line).
          </p>
        </header>
        <Link href="/payroll">
          <Button variant="outline" size="sm">
            ← Back to Payroll
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Open bills
          </p>
          <p className="text-lg font-semibold text-slate-900 tabular-nums">
            {open.length}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Net pay outstanding
          </p>
          <p className="text-lg font-semibold text-slate-900 tabular-nums">
            {formatMoney(openNet)}
          </p>
        </div>
      </div>

      {bills.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-500">
            No payroll bills yet. Lock a pay period on the Payroll page, then
            use &quot;Generate payroll bills&quot; — each employee&apos;s
            accrual will appear here.
          </CardContent>
        </Card>
      ) : (
        [...periods.entries()].map(([key, rows]) => {
          const [start, end] = key.split('|');
          const periodNet = rows.reduce((s, b) => s + Number(b.net), 0);
          return (
            <Card key={key}>
              <CardContent className="p-0">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Pay period {start} – {end}
                  </h2>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {rows.length} bill{rows.length === 1 ? '' : 's'} · net{' '}
                    {formatMoney(periodNet)}
                  </span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">NIB (emp.)</TableHead>
                      <TableHead className="text-right">NIB (co.)</TableHead>
                      <TableHead className="text-right">Additions</TableHead>
                      <TableHead className="text-right">Deductions</TableHead>
                      <TableHead className="text-right">Net pay</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Paid from</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium text-slate-900">
                          {b.employeeName}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(b.gross)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(b.employeeNib)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(b.employerNib)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(b.additions) !== 0 ? money(b.additions) : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(b.deductions) !== 0 ? money(b.deductions) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {money(b.net)}
                        </TableCell>
                        <TableCell>
                          {b.status === 'paid' ? (
                            <span className="inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-800">
                              paid
                            </span>
                          ) : b.status === 'void' ? (
                            <span className="inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">
                              void
                            </span>
                          ) : (
                            <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
                              open
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {b.paidFrom ? (
                            <a
                              href={`/banking/accounts/${b.paidFrom.bankAccountId}?q=${encodeURIComponent(
                                b.paidFrom.description,
                              )}&reviewed=1`}
                              className="text-blue-700 hover:underline"
                              title={b.paidFrom.description}
                            >
                              {b.paidFrom.accountName} · {b.paidFrom.transactionDate}
                            </a>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
