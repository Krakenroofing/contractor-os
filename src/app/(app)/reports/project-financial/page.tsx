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
import { formatMoney, formatPercent } from '@/lib/money';
import { listProjects } from '@/lib/data/projects';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { buildProjectFinancialReport } from '@/modules/reports/lib/reports';
import { ReportShell } from '@/modules/reports/components/report-shell';

export const dynamic = 'force-dynamic';

export default async function ProjectFinancialReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const filters = parseReportFilters(await searchParams);
  const [report, projects] = await Promise.all([
    buildProjectFinancialReport(company.id, filters),
    listProjects(company.id),
  ]);

  return (
    <ReportShell
      type="project-financial"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: `${p.number} — ${p.name}` }))}
      companyName={company.name}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI
          label="Revenue invoiced (net)"
          value={formatMoney(report.totals.totalInvoicedNet)}
          hint={`VAT ${formatMoney(report.totals.totalInvoicedVat)} · gross ${formatMoney(report.totals.totalInvoiced)}`}
          highlight
        />
        <KPI
          label="Revenue collected (net)"
          value={formatMoney(report.totals.totalPaidNet)}
          valueClassName="text-emerald-700"
          hint={`VAT collected ${formatMoney(report.totals.totalPaidVat)} · gross ${formatMoney(report.totals.totalPaid)}`}
        />
        <KPI
          label="Base vs CO invoiced (gross)"
          value={formatMoney(report.totals.totalInvoiced)}
          hint={`base ${formatMoney(report.totals.baseInvoiced)} · CO ${formatMoney(report.totals.coInvoiced)}`}
        />
        <KPI
          label="Outstanding AR (gross)"
          value={formatMoney(report.totals.outstandingAR)}
          valueClassName={report.totals.outstandingAR > 0 ? 'text-amber-700' : undefined}
        />
        <KPI
          label="Retainage held"
          value={formatMoney(report.totals.retainageHeld - report.totals.retainageReleased)}
        />
        <KPI
          label="Gross profit"
          value={formatMoney(report.totals.grossProfit)}
          valueClassName={
            report.totals.grossProfit < 0 ? 'text-red-600' : 'text-emerald-700'
          }
        />
      </div>
      <p className="text-xs text-slate-500">
        <strong>Revenue</strong> = invoice subtotal (ex-VAT). <strong>VAT</strong>{' '}
        is a liability collected on behalf of the government — never income.
        Gross = revenue + VAT − retainage held.
      </p>
      <p className="text-xs text-slate-500 -mt-2">
        <strong>Revised contract:</strong>{' '}
        {formatMoney(report.totals.revisedContractValue)} (base + approved COs).
      </p>

      <p className="text-sm text-slate-600">
        Portfolio margin: <span className="font-semibold tabular-nums">{formatPercent(report.weightedMarginPct, 2)}</span>
      </p>

      {report.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No projects match the current filters.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Contract</TableHead>
                <TableHead className="text-right">CO</TableHead>
                <TableHead className="text-right">Revised</TableHead>
                <TableHead className="text-right">Invoiced (net)</TableHead>
                <TableHead className="text-right">Paid (net)</TableHead>
                <TableHead className="text-right">AR</TableHead>
                <TableHead className="text-right">Retainage</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">GP</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={r.projectId}>
                  <TableCell className="font-medium text-slate-900">
                    <span className="font-mono text-xs text-slate-500 mr-2">
                      {r.projectNumber}
                    </span>
                    {r.projectName}
                    {r.verifiedAt && (
                      <Badge tone="green" className="ml-2">
                        Verified
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-600">{r.customerName}</TableCell>
                  <TableCell className="text-slate-600">{r.status.replace('_', ' ')}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.contractValue)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {formatMoney(r.changeOrders)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatMoney(r.revisedContractValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div>{formatMoney(r.totalInvoicedNet)}</div>
                    <div className="text-[11px] text-slate-500 font-normal">
                      VAT {formatMoney(r.totalInvoicedVat)} · gross{' '}
                      {formatMoney(r.totalInvoiced)}
                    </div>
                    {(r.coInvoiced > 0 || r.changeOrders > 0) && (
                      <div className="text-[11px] text-slate-500 font-normal">
                        base {formatMoney(r.baseInvoiced)} ·{' '}
                        CO {formatMoney(r.coInvoiced)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">
                    <div>{formatMoney(r.totalPaidNet)}</div>
                    <div className="text-[11px] text-slate-500 font-normal">
                      VAT {formatMoney(r.totalPaidVat)} · gross{' '}
                      {formatMoney(r.totalPaid)}
                    </div>
                    {(r.coInvoicedPaid > 0 || r.changeOrders > 0) && (
                      <div className="text-[11px] text-slate-500 font-normal">
                        base {formatMoney(r.baseInvoicedPaid)} ·{' '}
                        CO {formatMoney(r.coInvoicedPaid)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      r.outstandingAR > 0 ? 'text-amber-700' : 'text-slate-600'
                    }`}
                  >
                    {formatMoney(r.outstandingAR)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.retainageBalance)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {formatMoney(r.totalCost)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      r.grossProfit < 0 ? 'text-red-600' : 'text-emerald-700'
                    }`}
                  >
                    {formatMoney(r.grossProfit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(r.marginPct, 2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
