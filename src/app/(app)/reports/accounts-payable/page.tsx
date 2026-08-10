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
import {
  parseApDefaultTermsDays,
  parseReportFilters,
} from '@/modules/reports/lib/filters';
import {
  AGING_BUCKETS,
  BUCKET_LABEL,
  buildAPReport,
} from '@/modules/reports/lib/reports';
import { ReportShell } from '@/modules/reports/components/report-shell';
import { ApDefaultTermsPicker } from '@/modules/reports/components/ap-default-terms-picker';

export const dynamic = 'force-dynamic';

export default async function APReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const params = await searchParams;
  const filters = parseReportFilters(params);
  const rawDefaultTerms = Array.isArray(params.defaultTermsDays)
    ? params.defaultTermsDays[0]
    : params.defaultTermsDays;
  const defaultTermsDays = parseApDefaultTermsDays(rawDefaultTerms);

  const [report, projects] = await Promise.all([
    buildAPReport(company.id, filters, defaultTermsDays),
    listProjects(company.id),
  ]);

  return (
    <ReportShell
      type="accounts-payable"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: p.name }))}
      companyName={company.name}
    >
      <ApDefaultTermsPicker selected={defaultTermsDays} />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI
          label="Total AP"
          value={formatMoney(report.summary.totalAP)}
          hint={`${report.summary.poItemCount} PO · ${report.summary.subItemCount} sub`}
          highlight
        />
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
        {report.summary.itemCount} open commitment
        {report.summary.itemCount === 1 ? '' : 's'}
        {report.summary.overdueCount > 0
          ? ` · ${report.summary.overdueCount} overdue`
          : ' · all current'}
        · as of {report.asOf.toISOString().slice(0, 10)} · vendors without
        terms on file default to{' '}
        {defaultTermsDays === 0
          ? 'Due on receipt'
          : `Net ${defaultTermsDays}`}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>By vendor</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {report.vendorRows.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No outstanding AP. Either nothing is open (POs all closed/void,
              sub payments all paid) or no source data exists yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total AP</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">1–30</TableHead>
                  <TableHead className="text-right">31–60</TableHead>
                  <TableHead className="text-right">61–90</TableHead>
                  <TableHead className="text-right">90+</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.vendorRows.map((v) => (
                  <TableRow key={v.vendorId}>
                    <TableCell className="font-medium text-slate-900">
                      {v.vendorName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v.itemCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(v.totalAP)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">
                      {formatMoney(v.current)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(v.b1_30)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(v.b31_60)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-red-600">
                      {formatMoney(v.b61_90)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-red-600">
                      {formatMoney(v.b90_plus)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v.overdueCount === 0 ? (
                        <span className="text-slate-400">0</span>
                      ) : (
                        <Badge tone="red">{v.overdueCount}</Badge>
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
          <CardTitle>Open commitments</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {report.agingRows.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No open commitments.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Vendor inv #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Issue date</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Terms</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.agingRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">
                      {r.sourceType === 'po' ? (
                        <Link
                          href={{ pathname: `/purchase-orders/${r.sourceId}` }}
                          className="font-mono text-blue-700 underline underline-offset-2 hover:text-blue-900"
                          title="Open this PO — add the vendor's invoice number there"
                        >
                          {r.sourceLabel}
                        </Link>
                      ) : (
                        <Badge tone="amber">Sub</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {r.vendorInvoiceNumber ?? (
                        <span className="text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-700">{r.vendorName}</TableCell>
                    <TableCell className="text-slate-600">
                      {r.projectName ?? <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="text-slate-600">{r.issueDate}</TableCell>
                    <TableCell className="text-slate-600">{r.dueDate}</TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {r.termsLabel}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-amber-700">
                      {formatMoney(r.amount)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        r.daysOverdue > 0
                          ? 'text-red-600 font-medium'
                          : 'text-slate-500'
                      }`}
                    >
                      {r.daysOverdue}
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
  hint,
  highlight,
  valueClassName,
}: {
  label: string;
  value: string;
  hint?: string;
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
        {hint && <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">{hint}</p>}
      </CardContent>
    </Card>
  );
}

