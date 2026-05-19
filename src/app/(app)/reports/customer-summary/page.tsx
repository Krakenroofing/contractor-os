import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
import { listCustomers } from '@/lib/data/customers';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { buildCustomerSummaryReport } from '@/modules/reports/lib/reports';
import { ReportShell } from '@/modules/reports/components/report-shell';

export const dynamic = 'force-dynamic';

export default async function CustomerSummaryReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const filters = parseReportFilters(await searchParams);
  const [report, projects, customers] = await Promise.all([
    buildCustomerSummaryReport(company.id, filters),
    listProjects(company.id),
    listCustomers(company.id),
  ]);

  return (
    <ReportShell
      type="customer-summary"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: `${p.number} — ${p.name}` }))}
      customers={customers.map((c) => ({ id: c.id, label: c.name }))}
      companyName={company.name}
    >
      {!report.customer ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">
            Pick a customer in the filter bar above to see their projects,
            billing status, and invoices.
          </p>
        </div>
      ) : (
        <>
          <header className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">
              {report.customer.name}
            </h2>
            <p className="text-sm text-slate-500">
              {report.totals.projectCount} project
              {report.totals.projectCount === 1 ? '' : 's'} ·{' '}
              {report.totals.invoiceCount} invoice
              {report.totals.invoiceCount === 1 ? '' : 's'}
            </p>
          </header>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <KPI
              label="Contract value"
              value={formatMoney(report.totals.revisedContractValue)}
              hint={`base ${formatMoney(report.totals.contractValue)} · CO ${formatMoney(
                report.totals.changeOrders,
              )}`}
              highlight
            />
            <KPI
              label="Billed (gross)"
              value={formatMoney(report.totals.totalInvoiced)}
              hint={`net ${formatMoney(report.totals.totalInvoicedNet)} · VAT ${formatMoney(
                report.totals.totalInvoicedVat,
              )}`}
            />
            <KPI
              label="Still billable"
              value={formatMoney(report.totals.stillBillable)}
              valueClassName={
                report.totals.stillBillable < 0
                  ? 'text-red-600'
                  : report.totals.stillBillable > 0
                    ? 'text-slate-900'
                    : 'text-emerald-700'
              }
              hint="Revised contract − billed (net)"
            />
            <KPI
              label="Collected (gross)"
              value={formatMoney(report.totals.totalPaid)}
              valueClassName="text-emerald-700"
              hint={`net ${formatMoney(report.totals.totalPaidNet)} · VAT ${formatMoney(
                report.totals.totalPaidVat,
              )}`}
            />
            <KPI
              label="Outstanding AR"
              value={formatMoney(report.totals.outstandingAR)}
              valueClassName={
                report.totals.outstandingAR > 0 ? 'text-amber-700' : undefined
              }
            />
            <KPI
              label="Retainage held"
              value={formatMoney(report.totals.retainageBalance)}
            />
          </div>

          <h3 className="text-xs uppercase tracking-wide font-medium text-slate-500 pt-2">
            Projects
          </h3>
          {report.projectRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
              <p className="text-slate-600 text-sm">
                No projects on file for this customer yet.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Contract value</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Still billable</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right">Retainage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.projectRows.map((r) => (
                    <TableRow key={r.projectId}>
                      <TableCell className="font-medium text-slate-900">
                        <Link
                          href={{ pathname: `/projects/${r.projectId}` }}
                          className="hover:underline"
                        >
                          <span className="font-mono text-xs text-slate-500 mr-2">
                            {r.projectNumber}
                          </span>
                          {r.projectName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600 capitalize">
                        {r.status.replace('_', ' ')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div className="font-medium">
                          {formatMoney(r.revisedContractValue)}
                        </div>
                        {r.changeOrders > 0 && (
                          <div className="text-[11px] text-slate-500 font-normal">
                            base {formatMoney(r.contractValue)} · CO{' '}
                            {formatMoney(r.changeOrders)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>{formatMoney(r.totalInvoiced)}</div>
                        <div className="text-[11px] text-slate-500 font-normal">
                          net {formatMoney(r.totalInvoicedNet)}
                        </div>
                        {(r.coInvoiced > 0 || r.changeOrders > 0) && (
                          <div className="text-[11px] text-slate-500 font-normal">
                            base {formatMoney(r.baseInvoiced)} · CO{' '}
                            {formatMoney(r.coInvoiced)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          r.stillBillable < 0
                            ? 'text-red-600'
                            : r.stillBillable === 0
                              ? 'text-emerald-700'
                              : 'text-slate-900'
                        }`}
                      >
                        {formatMoney(r.stillBillable)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">
                        <div>{formatMoney(r.totalPaid)}</div>
                        <div className="text-[11px] text-slate-500 font-normal">
                          net {formatMoney(r.totalPaidNet)}
                        </div>
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          r.outstandingAR > 0 ? 'text-amber-700' : 'text-slate-600'
                        }`}
                      >
                        {formatMoney(r.outstandingAR)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.retainageBalance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <h3 className="text-xs uppercase tracking-wide font-medium text-slate-500 pt-2">
            Invoices ({report.totals.invoiceCount})
          </h3>
          {report.invoiceRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
              <p className="text-slate-600 text-sm">
                No invoices billed to this customer in the selected range yet.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total (gross)</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">VAT</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.invoiceRows.map((r) => (
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
                        {r.invoiceDate}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        <span className="font-mono text-xs text-slate-500 mr-1">
                          {r.projectNumber}
                        </span>
                        {r.projectName}
                      </TableCell>
                      <TableCell>
                        {r.source === 'co' ? (
                          <Badge tone="blue">
                            {r.changeOrderNumber ?? 'CO'}
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-500">Base</span>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600 capitalize">
                        {r.status}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(r.total)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {formatMoney(r.subtotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {formatMoney(r.taxAmount)}
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
            </div>
          )}

          <p className="text-xs text-slate-500">
            <strong>Contract value</strong> is the revised contract (base +
            approved COs), stored net of VAT. <strong>Billed (gross)</strong>{' '}
            includes VAT; the net + VAT breakdown is shown beneath.{' '}
            <strong>Still billable</strong> = revised contract − billed{' '}
            <em>net</em> — net vs net, because VAT is a separate liability
            collected on behalf of the government and is not part of contract
            scope. Negative means over-billed.{' '}
            <strong>Collected (gross)</strong> includes VAT received; the
            net + VAT breakdown is shown beneath.{' '}
            <strong>Outstanding AR</strong> = billed − collected (both gross).
          </p>
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
        <p className={`mt-1 text-xl font-semibold tabular-nums ${valueClassName ?? 'text-slate-900'}`}>
          {value}
        </p>
        {hint && <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">{hint}</p>}
      </CardContent>
    </Card>
  );
}
