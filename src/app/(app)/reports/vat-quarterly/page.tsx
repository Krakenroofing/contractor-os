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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPI label="VAT rate" value={`${report.companyVatRatePct.toFixed(2)}%`} />
            <KPI label="Sent invoices" value={String(report.totals.invoiceCount)} />
            <KPI
              label="Subtotal (ex-VAT)"
              value={formatMoney(report.totals.subtotal)}
            />
            <KPI
              label="Total VAT due"
              value={formatMoney(report.totals.vatDue)}
              valueClassName="text-amber-700"
              highlight
            />
          </div>

          <p className="text-xs text-slate-500">
            Accrual basis — every non-draft / non-void invoice contributes VAT
            for the quarter it was sent in. Date used: <code>sentAt</code>{' '}
            (falls back to <code>invoiceDate</code> for older rows).
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
                      <TableHead className="text-right">Subtotal</TableHead>
                      <TableHead className="text-right">VAT due</TableHead>
                      <TableHead className="text-right">Total billed</TableHead>
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
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(q.subtotal)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-amber-700">
                          {formatMoney(q.vatDue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">
                          {formatMoney(q.total)}
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
                      <TableHead>Sent / dated</TableHead>
                      <TableHead>Quarter</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                      <TableHead className="text-right">VAT due</TableHead>
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
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            valueClassName ?? 'text-slate-900'
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
