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
import { formatMoney, formatPercent } from '@/lib/money';
import { listProjects } from '@/lib/data/projects';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { taxLabel } from '@/modules/reports/lib/tax-label';
import { buildLandedCostReport } from '@/modules/reports/lib/reports';
import { ReportShell } from '@/modules/reports/components/report-shell';

export const dynamic = 'force-dynamic';

export default async function LandedCostReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const tax = taxLabel(company.isVatActive);
  const filters = parseReportFilters(await searchParams);
  const [report, projects] = await Promise.all([
    buildLandedCostReport(company.id, filters),
    listProjects(company.id),
  ]);

  return (
    <ReportShell
      type="landed-cost"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: p.name }))}
      companyName={company.name}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI label="Entries" value={String(report.rows.length)} />
        <KPI label="FOB" value={formatMoney(report.totals.fob)} />
        <KPI label="CIF" value={formatMoney(report.totals.cif)} />
        <KPI label={`Duty + ${tax}`} value={formatMoney(report.totals.dutyAmount + report.totals.vatAmount)} />
        <KPI label="Brokerage" value={formatMoney(report.totals.brokerage)} />
        <KPI
          label="Total landed"
          value={formatMoney(report.totals.totalLandedCost)}
          highlight
        />
      </div>

      <p className="text-sm text-slate-600">
        Effective duty + {tax} vs. CIF:{' '}
        <span className="font-semibold tabular-nums">{formatPercent(report.effectiveDutyVatPct, 2)}</span>
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Detail</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {report.rows.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No landed-cost entries in range.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Tariff code</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">FOB</TableHead>
                  <TableHead className="text-right">CIF</TableHead>
                  <TableHead className="text-right">Duty</TableHead>
                  <TableHead className="text-right">{tax}</TableHead>
                  <TableHead className="text-right">Total landed</TableHead>
                  <TableHead className="text-right">Per unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-slate-900">
                      <Link href={{ pathname: `/landed-cost/${r.id}` }} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600">{r.carrier ?? '—'}</TableCell>
                    <TableCell className="text-slate-700">{r.projectName}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {r.tariffCode ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.quantity.toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.fob)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.cif)}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {formatMoney(r.dutyAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {formatMoney(r.vatAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(r.totalLandedCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.perUnitCost)}</TableCell>
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
