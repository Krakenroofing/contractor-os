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
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listProjects } from '@/lib/data/projects';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { buildVatQuarterlyReport } from '@/modules/reports/lib/reports';
import { ReportShell } from '@/modules/reports/components/report-shell';

export const dynamic = 'force-dynamic';

export default async function VatQuarterlyReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const filters = parseReportFilters(await searchParams);
  const [report, projects] = await Promise.all([
    buildVatQuarterlyReport(company.id, filters),
    listProjects(company.id),
  ]);

  return (
    <ReportShell
      type="vat-quarterly"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: `${p.number} — ${p.name}` }))}
      companyName={company.name}
    >
      {!report.isVatActive ? (
        <Card>
          <CardContent className="p-8 text-center space-y-2">
            <p className="text-sm text-slate-600">
              VAT is not configured for{' '}
              <span className="font-medium text-slate-900">
                {report.companyName}
              </span>
              .
            </p>
            <p className="text-xs text-slate-500">
              Set <span className="font-mono">VAT rate</span> in{' '}
              <Link href="/settings" className="underline hover:text-slate-900">
                Company Settings
              </Link>{' '}
              to activate this report.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {(() => {
            const now = new Date();
            const cy = now.getUTCFullYear();
            const cq = Math.min(
              4,
              Math.max(1, Math.ceil((now.getUTCMonth() + 1) / 3)),
            );
            const currentKey = `${cy}-Q${cq}`;
            const current = report.quarters.find(
              (q) => q.quarterKey === currentKey,
            );
            if (!current) return null;
            const isDue = current.netVatDue > 0;
            return (
              <Card
                className={
                  isDue ? 'border-amber-300' : 'border-emerald-300'
                }
              >
                <CardHeader>
                  <CardTitle>
                    Current quarter — {current.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Output VAT (collected on sales)
                      </p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-700">
                        {formatMoney(current.vatDue)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {current.invoiceCount} invoice
                        {current.invoiceCount === 1 ? '' : 's'} this quarter
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Input VAT (offset from receipts)
                      </p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">
                        {formatMoney(current.inputVat)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {current.receiptCount} posted receipt
                        {current.receiptCount === 1 ? '' : 's'} this quarter
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Net VAT {isDue ? 'due to government' : 'reclaim balance'}
                      </p>
                      <p
                        className={`mt-1 text-3xl font-bold tabular-nums ${
                          isDue ? 'text-amber-700' : 'text-emerald-700'
                        }`}
                      >
                        {formatMoney(Math.abs(current.netVatDue))}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Output {formatMoney(current.vatDue)} − Input{' '}
                        {formatMoney(current.inputVat)} ={' '}
                        {isDue ? '+' : '−'}
                        {formatMoney(Math.abs(current.netVatDue))}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <KPI label="VAT rate" value={`${report.companyVatRatePct.toFixed(2)}%`} />
            <KPI
              label="Output VAT (sales)"
              value={formatMoney(report.totals.vatDue)}
              valueClassName="text-amber-700"
              hint={`${report.totals.invoiceCount} sent invoice(s)`}
            />
            <KPI
              label="Input VAT (expenses)"
              value={formatMoney(report.totals.inputVat)}
              valueClassName="text-emerald-700"
              hint={`${report.totals.receiptCount} posted receipt(s)`}
            />
            <KPI
              label="Net VAT due"
              value={formatMoney(report.totals.netVatDue)}
              valueClassName={
                report.totals.netVatDue > 0
                  ? 'text-amber-700'
                  : 'text-emerald-700'
              }
              highlight
            />
            <KPI
              label="Subtotal billed (ex-VAT)"
              value={formatMoney(report.totals.subtotal)}
            />
            <KPI
              label="Subtotal expenses (ex-VAT)"
              value={formatMoney(report.totals.expenseNet)}
            />
          </div>

          <p className="text-xs text-slate-500">
            Accrual basis. Output VAT = VAT on every non-draft / non-void
            invoice, bucketed by <strong>invoice date</strong>. Input VAT = VAT
            on every <strong>posted receipt</strong> marked recoverable.
            <strong> Net VAT due = output − input</strong> — positive means you
            pay the government for the quarter; negative means a reclaim
            balance.
          </p>

          <Card>
            <CardHeader>
              <CardTitle>By quarter</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {report.quarters.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">
                  No sent invoices in the selected date range.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quarter</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                      <TableHead className="text-right">Output VAT</TableHead>
                      <TableHead className="text-right">Receipts</TableHead>
                      <TableHead className="text-right">Input VAT</TableHead>
                      <TableHead className="text-right">Net VAT due</TableHead>
                      <TableHead className="text-right">Subtotal billed</TableHead>
                      <TableHead className="text-right">Retainage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.quarters.map((q) => (
                      <TableRow key={q.quarterKey}>
                        <TableCell className="font-medium text-slate-900">
                          {q.label}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {q.invoiceCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-amber-700">
                          {formatMoney(q.vatDue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {q.receiptCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-emerald-700">
                          {formatMoney(q.inputVat)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums font-semibold ${
                            q.netVatDue > 0
                              ? 'text-amber-700'
                              : q.netVatDue < 0
                                ? 'text-emerald-700'
                                : ''
                          }`}
                        >
                          {formatMoney(q.netVatDue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(q.subtotal)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">
                          {q.retainage > 0 ? `(${formatMoney(q.retainage)})` : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invoice detail</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {report.invoices.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No invoices.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Invoice date</TableHead>
                      <TableHead>Quarter</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                      <TableHead className="text-right">VAT due</TableHead>
                      <TableHead className="text-right">Retainage</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.invoices.map((r) => (
                      <TableRow key={r.invoiceId}>
                        <TableCell className="font-mono text-xs text-slate-700">
                          <Link
                            href={{ pathname: `/invoices/${r.invoiceId}` }}
                            className="hover:underline"
                          >
                            {r.invoiceNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-600">
                          {r.customerName}
                        </TableCell>
                        <TableCell className="text-slate-700">
                          {r.projectNumber
                            ? `${r.projectNumber} — ${r.projectName ?? ''}`
                            : '—'}
                        </TableCell>
                        <TableCell className="text-slate-600">
                          {r.effectiveDate}
                        </TableCell>
                        <TableCell className="text-slate-700">
                          {r.quarterKey.replace(/^(\d{4})-(Q\d)$/, '$2 $1')}
                        </TableCell>
                        <TableCell className="text-slate-600 capitalize">
                          {r.status}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(r.subtotal)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-amber-700">
                          {formatMoney(r.vatDue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">
                          {r.retainage > 0 ? `(${formatMoney(r.retainage)})` : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(r.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Expense detail (input VAT)</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {report.expenses.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">
                  No posted receipts in the selected date range.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Receipt date</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Quarter</TableHead>
                      <TableHead>Recoverable</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                      <TableHead className="text-right">Input VAT</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.expenses.map((r) => (
                      <TableRow key={r.receiptId}>
                        <TableCell className="text-xs font-mono">
                          <Link
                            href={{ pathname: `/banking/receipts/${r.receiptId}` }}
                            className="hover:underline"
                          >
                            {r.receiptDate}
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-700">
                          {r.vendorName}
                        </TableCell>
                        <TableCell className="text-slate-700">
                          {r.projectNumber
                            ? `${r.projectNumber} — ${r.projectName ?? ''}`
                            : '—'}
                        </TableCell>
                        <TableCell className="text-slate-700">
                          {r.quarterKey.replace(/^(\d{4})-(Q\d)$/, '$2 $1')}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.recoverable ? (
                            <span className="inline-block rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5">
                              recoverable
                            </span>
                          ) : (
                            <span className="inline-block rounded bg-slate-200 text-slate-700 px-1.5 py-0.5">
                              non-recoverable
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(r.subtotal)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums font-medium ${
                            r.recoverable ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          {formatMoney(r.inputVat)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(r.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </ReportShell>
  );
}

function KPI({
  label,
  value,
  highlight,
  valueClassName,
  hint,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  valueClassName?: string;
  hint?: string;
}) {
  return (
    <Card className={highlight ? 'border-slate-300' : undefined}>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            valueClassName ?? 'text-slate-900'
          }`}
        >
          {value}
        </p>
        {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
      </CardContent>
    </Card>
  );
}
