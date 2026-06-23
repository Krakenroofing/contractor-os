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
import { taxLabel } from '@/modules/reports/lib/tax-label';
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
  const tax = taxLabel(company.isVatActive);
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
      projects={projects.map((p) => ({ id: p.id, label: p.name }))}
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
              hint={`net ${formatMoney(report.totals.totalInvoicedNet)} · ${tax} ${formatMoney(
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
              hint={
                report.totals.refundsCredited > 0
                  ? `Revised contract − billed (net), net of ${formatMoney(
                      report.totals.refundsCredited,
                    )} refunded`
                  : 'Revised contract − billed (net)'
              }
            />
            <KPI
              label="Collected (gross)"
              value={formatMoney(report.totals.totalPaid)}
              valueClassName="text-emerald-700"
              hint={`net ${formatMoney(report.totals.totalPaidNet)} · ${tax} ${formatMoney(
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
            // Wide audit-grade layout: every gross / net / VAT amount lives in
            // its own column so a government audit can trace each figure
            // without parsing stacked sub-labels. Overflow on screen for the
            // 14-column table; the print-mode landscape page (see <style>
            // block below) makes the whole grid fit on paper.
            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right whitespace-pre-line">{`Base\ncontract`}</TableHead>
                    <TableHead className="text-right whitespace-pre-line">{`Approved\nCO`}</TableHead>
                    <TableHead className="text-right whitespace-pre-line">{`Revised\ncontract`}</TableHead>
                    <TableHead className="text-right whitespace-pre-line">{`Billed\nnet`}</TableHead>
                    <TableHead className="text-right whitespace-pre-line">{`Billed\n${tax}`}</TableHead>
                    <TableHead className="text-right whitespace-pre-line">{`Billed\ngross`}</TableHead>
                    <TableHead className="text-right whitespace-pre-line">{`Collected\nnet`}</TableHead>
                    <TableHead className="text-right whitespace-pre-line">{`Collected\n${tax}`}</TableHead>
                    <TableHead className="text-right whitespace-pre-line">{`Collected\ngross`}</TableHead>
                    <TableHead className="text-right whitespace-pre-line">{`Still\nbillable`}</TableHead>
                    <TableHead className="text-right whitespace-pre-line">{`Outstanding\nAR`}</TableHead>
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
                          {r.projectName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600 capitalize">
                        {r.status.replace('_', ' ')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.contractValue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {formatMoney(r.changeOrders)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(r.revisedContractValue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.totalInvoicedNet)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {formatMoney(r.totalInvoicedVat)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(r.totalInvoiced)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">
                        {formatMoney(r.totalPaidNet)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {formatMoney(r.totalPaidVat)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700 font-medium">
                        {formatMoney(r.totalPaid)}
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
                        {r.refundsCredited > 0 && (
                          <span className="block text-[10px] font-normal text-slate-400">
                            net of {formatMoney(r.refundsCredited)} refunded
                          </span>
                        )}
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
                  {/* Totals row — matches the KPI tiles and gives auditors a
                      single anchored line per customer that ties out to every
                      column. Styled distinctly so it doesn't get mistaken for
                      another project. */}
                  <TableRow className="bg-slate-50 font-semibold border-t-2 border-slate-300">
                    <TableCell colSpan={2} className="text-slate-900 uppercase text-xs tracking-wide">
                      Totals ({report.totals.projectCount} project
                      {report.totals.projectCount === 1 ? '' : 's'})
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.totals.contractValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.totals.changeOrders)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.totals.revisedContractValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.totals.totalInvoicedNet)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.totals.totalInvoicedVat)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.totals.totalInvoiced)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">
                      {formatMoney(report.totals.totalPaidNet)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.totals.totalPaidVat)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">
                      {formatMoney(report.totals.totalPaid)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        report.totals.stillBillable < 0 ? 'text-red-600' : ''
                      }`}
                    >
                      {formatMoney(report.totals.stillBillable)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        report.totals.outstandingAR > 0 ? 'text-amber-700' : ''
                      }`}
                    >
                      {formatMoney(report.totals.outstandingAR)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.totals.retainageBalance)}
                    </TableCell>
                  </TableRow>
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
                    <TableHead className="text-right">{tax}</TableHead>
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
            approved COs), stored net of {tax}. <strong>Billed (gross)</strong>{' '}
            includes {tax}; the net + {tax} breakdown is shown beneath.{' '}
            <strong>Still billable</strong> = revised contract − billed{' '}
            <em>net</em> — net vs net, because {tax} is a separate liability
            collected on behalf of the government and is not part of contract
            scope. Negative means over-billed. When a canceled/reduced scope is
            refunded and booked as a deduct change order, that refund is netted
            back out of billed here (the deduct CO already lowered the revised
            contract by the same amount), so the two sides stay balanced.{' '}
            <strong>Collected (gross)</strong> includes {tax} received; the
            net + {tax} breakdown is shown beneath.{' '}
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
