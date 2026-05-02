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
import { buildPOSummaryReport } from '@/modules/reports/lib/reports';
import { ReportShell } from '@/modules/reports/components/report-shell';
import { StatusBadge } from '@/modules/status/components/status-badge';

export const dynamic = 'force-dynamic';

export default async function POSummaryReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const filters = parseReportFilters(await searchParams);
  const [report, projects] = await Promise.all([
    buildPOSummaryReport(company.id, filters),
    listProjects(company.id),
  ]);

  return (
    <ReportShell
      type="purchase-orders"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: `${p.number} — ${p.name}` }))}
      companyName={company.name}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI label="POs" value={String(report.rows.length)} />
        <KPI label="Subtotal" value={formatMoney(report.totals.subtotal)} />
        <KPI label="Tax" value={formatMoney(report.totals.taxAmount)} />
        <KPI label="Shipping" value={formatMoney(report.totals.shipping)} />
        <KPI
          label="Open"
          value={formatMoney(report.totals.open)}
          valueClassName={report.totals.open > 0 ? 'text-amber-700' : undefined}
        />
        <KPI label="Total" value={formatMoney(report.totals.total)} highlight />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By status</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {report.byStatus.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No POs in range.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byStatus.map((s) => (
                  <TableRow key={s.status}>
                    <TableCell>
                      <StatusBadge entityType="purchase_order" status={s.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(s.total)}</TableCell>
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
            <p className="p-6 text-sm text-slate-500">No POs in range.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO</TableHead>
                  <TableHead>Issue date</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">Shipping</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r) => (
                  <TableRow key={r.poId}>
                    <TableCell className="font-mono text-xs">
                      <Link href={{ pathname: `/purchase-orders/${r.poId}` }} className="hover:underline">
                        {r.poNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600">{r.issueDate ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">{r.expectedDeliveryDate ?? '—'}</TableCell>
                    <TableCell className="text-slate-700">{r.vendorName}</TableCell>
                    <TableCell className="text-slate-700">{r.projectName}</TableCell>
                    <TableCell>
                      <StatusBadge entityType="purchase_order" status={r.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.lineCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.subtotal)}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {formatMoney(r.taxAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {formatMoney(r.shipping)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(r.total)}
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
