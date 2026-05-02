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
import { buildPaymentSummaryReport } from '@/modules/reports/lib/reports';
import { ReportShell } from '@/modules/reports/components/report-shell';
import { StatusBadge } from '@/modules/status/components/status-badge';

export const dynamic = 'force-dynamic';

export default async function PaymentSummaryReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const filters = parseReportFilters(await searchParams);
  const [report, projects] = await Promise.all([
    buildPaymentSummaryReport(company.id, filters),
    listProjects(company.id),
  ]);

  return (
    <ReportShell
      type="payment-summary"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: `${p.number} — ${p.name}` }))}
      companyName={company.name}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KPI label="Total" value={formatMoney(report.totals.total)} highlight />
        <KPI
          label="Received"
          value={formatMoney(report.totals.received)}
          valueClassName="text-emerald-700"
        />
        <KPI
          label="Applied"
          value={formatMoney(report.totals.applied)}
          valueClassName="text-emerald-700"
        />
        <KPI
          label="Pending"
          value={formatMoney(report.totals.pending)}
          valueClassName={report.totals.pending > 0 ? 'text-amber-700' : undefined}
        />
        <KPI
          label="Returned"
          value={formatMoney(report.totals.returned)}
          valueClassName={report.totals.returned > 0 ? 'text-red-600' : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By method</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {report.byMethod.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No payments to summarize.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byMethod.map((m) => (
                  <TableRow key={m.method}>
                    <TableCell className="font-medium text-slate-900">{m.method}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.count}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(m.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Detail</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {report.rows.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No payments in range.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r) => (
                  <TableRow key={r.paymentId}>
                    <TableCell className="font-mono text-xs">
                      <Link href={{ pathname: `/payments/${r.paymentId}` }} className="hover:underline">
                        {r.paymentNumber || '—'}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600">{r.paidDate}</TableCell>
                    <TableCell className="text-slate-700">{r.customerName}</TableCell>
                    <TableCell className="text-slate-700">{r.projectName}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {r.invoiceNumber}
                    </TableCell>
                    <TableCell className="text-slate-600">{r.method ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge entityType="payment" status={r.status} />
                    </TableCell>
                    <TableCell className="text-slate-600 font-mono text-xs">
                      {r.reference ?? '—'}
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs">
                      {r.bankAccount ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(r.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  );
}

function KPI({
  label,
  value,
  highlight,
  valueClassName,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  valueClassName?: string;
}) {
  return (
    <Card className={highlight ? 'border-slate-300' : undefined}>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-1 text-xl font-semibold tabular-nums ${valueClassName ?? 'text-slate-900'}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
