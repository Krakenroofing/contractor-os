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
import { taxLabel } from '@/modules/reports/lib/tax-label';
import { buildInvoiceSummaryReport } from '@/modules/reports/lib/reports';
import { ReportShell } from '@/modules/reports/components/report-shell';
import { StatusBadge } from '@/modules/status/components/status-badge';

export const dynamic = 'force-dynamic';

export default async function InvoiceSummaryReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'invoices')) redirect('/dashboard');
  const company = await getActiveCompany();
  const tax = taxLabel(company.isVatActive);
  const filters = parseReportFilters(await searchParams);
  const [report, projects] = await Promise.all([
    buildInvoiceSummaryReport(company.id, filters),
    listProjects(company.id),
  ]);

  return (
    <ReportShell
      type="invoice-summary"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: p.name }))}
      companyName={company.name}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI label="Invoices" value={String(report.rows.length)} />
        <KPI label="Subtotal" value={formatMoney(report.totals.subtotal)} />
        <KPI label={tax} value={formatMoney(report.totals.taxAmount)} />
        <KPI label="Retainage held" value={formatMoney(report.totals.retainageHeld)} />
        <KPI label="Total invoiced" value={formatMoney(report.totals.total)} highlight />
        <KPI
          label="Balance"
          value={formatMoney(report.totals.balance)}
          valueClassName={report.totals.balance > 0 ? 'text-amber-700' : 'text-emerald-700'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detail</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {report.rows.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No invoices match the filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="text-right">{tax}</TableHead>
                  <TableHead className="text-right">Retainage</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r) => (
                  <TableRow key={r.invoiceId}>
                    <TableCell className="font-mono text-xs text-slate-700">
                      <Link href={{ pathname: `/invoices/${r.invoiceId}` }} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">
                        {r.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600">{r.customerName}</TableCell>
                    <TableCell className="text-slate-700">{r.projectName}</TableCell>
                    <TableCell>
                      <StatusBadge entityType="invoice" status={r.status} />
                    </TableCell>
                    <TableCell className="text-slate-600">{r.billingType.replace('_', ' ')}</TableCell>
                    <TableCell className="text-slate-600">{r.invoiceDate}</TableCell>
                    <TableCell className="text-slate-600">{r.dueDate ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.subtotal)}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {formatMoney(r.taxAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {formatMoney(r.retainageHeld)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(r.total)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">
                      {formatMoney(r.amountPaid)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        r.balance > 0 ? 'text-amber-700 font-medium' : 'text-slate-500'
                      }`}
                    >
                      {formatMoney(r.balance)}
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
