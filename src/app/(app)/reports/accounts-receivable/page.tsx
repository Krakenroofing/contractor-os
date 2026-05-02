import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
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
import {
  AGING_BUCKETS,
  BUCKET_LABEL,
  buildARReport,
} from '@/modules/reports/lib/reports';
import { ReportShell } from '@/modules/reports/components/report-shell';

export const dynamic = 'force-dynamic';

export default async function ARReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const filters = parseReportFilters(await searchParams);
  const [report, projects] = await Promise.all([
    buildARReport(company.id, filters),
    listProjects(company.id),
  ]);

  return (
    <ReportShell
      type="accounts-receivable"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: `${p.number} — ${p.name}` }))}
      companyName={company.name}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI label="Total AR" value={formatMoney(report.summary.totalAR)} highlight />
        {AGING_BUCKETS.map((b) => (
          <KPI
            key={b}
            label={BUCKET_LABEL[b]}
            value={formatMoney(report.summary[b])}
            valueClassName={
              b === 'current'
                ? 'text-emerald-700'
                : b === 'b61_90' || b === 'b90_plus'
                  ? 'text-red-600'
                  : report.summary[b] > 0
                    ? 'text-amber-700'
                    : undefined
            }
          />
        ))}
      </div>

      <p className="text-sm text-slate-600">
        {report.summary.invoiceCount} open invoice
        {report.summary.invoiceCount === 1 ? '' : 's'}
        {report.summary.overdueCount > 0
          ? ` · ${report.summary.overdueCount} overdue`
          : ' · all current'}
        · as of {report.asOf.toISOString().slice(0, 10)}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>By customer</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {report.customerRows.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No outstanding AR.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="text-right">Total AR</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">1–30</TableHead>
                  <TableHead className="text-right">31–60</TableHead>
                  <TableHead className="text-right">61–90</TableHead>
                  <TableHead className="text-right">90+</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.customerRows.map((c) => (
                  <TableRow key={c.customerId || c.customerName}>
                    <TableCell className="font-medium text-slate-900">
                      {c.customerName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.invoiceCount}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(c.totalAR)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">
                      {formatMoney(c.current)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(c.b1_30)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(c.b31_60)}</TableCell>
                    <TableCell className="text-right tabular-nums text-red-600">
                      {formatMoney(c.b61_90)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-red-600">
                      {formatMoney(c.b90_plus)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.overdueCount === 0 ? (
                        <span className="text-slate-400">0</span>
                      ) : (
                        <Badge tone="red">{c.overdueCount}</Badge>
                      )}
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
          <CardTitle>Open invoices</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Invoice date</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.agingRows.map((r) => (
                <TableRow key={r.invoiceId}>
                  <TableCell className="font-mono text-xs text-slate-700">
                    <Link href={{ pathname: `/invoices/${r.invoiceId}` }} className="hover:underline">
                      {r.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">{r.customerName}</TableCell>
                  <TableCell className="text-slate-700">{r.projectName}</TableCell>
                  <TableCell className="text-slate-600">{r.invoiceDate}</TableCell>
                  <TableCell className="text-slate-600">{r.dueDate ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.total)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">
                    {formatMoney(r.amountPaid)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium text-amber-700">
                    {formatMoney(r.balance)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      r.daysOverdue > 0 ? 'text-red-600 font-medium' : 'text-slate-500'
                    }`}
                  >
                    {r.daysOverdue}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
