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
import { ApVendorPicker } from '@/modules/reports/components/ap-vendor-picker';

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

  const [fullReport, projects] = await Promise.all([
    buildAPReport(company.id, filters, defaultTermsDays),
    listProjects(company.id),
  ]);

  // Optional ?vendor= filter: narrow both tables to one vendor and
  // recompute the KPI tiles from the filtered rows so the totals match
  // what's on screen. The picker lists only vendors with open AP.
  const rawVendor = Array.isArray(params.vendor)
    ? params.vendor[0]
    : params.vendor;
  const vendorId =
    rawVendor && fullReport.vendorRows.some((v) => v.vendorId === rawVendor)
      ? rawVendor
      : '';
  const report = vendorId
    ? (() => {
        const agingRows = fullReport.agingRows.filter(
          (r) => r.vendorId === vendorId,
        );
        const vendorRows = fullReport.vendorRows.filter(
          (v) => v.vendorId === vendorId,
        );
        const commitmentRows = fullReport.commitmentRows.filter(
          (c) => c.vendorId === vendorId,
        );
        const sum = (b: (typeof agingRows)[number]['bucket']) =>
          agingRows
            .filter((r) => r.bucket === b)
            .reduce((s, r) => s + r.amount, 0);
        return {
          ...fullReport,
          agingRows,
          vendorRows,
          summary: {
            totalAP: agingRows.reduce((s, r) => s + r.amount, 0),
            current: sum('current'),
            b1_30: sum('b1_30'),
            b31_60: sum('b31_60'),
            b61_90: sum('b61_90'),
            b90_plus: sum('b90_plus'),
            itemCount: agingRows.length,
            overdueCount: agingRows.filter((r) => r.daysOverdue > 0).length,
            poItemCount: commitmentRows.length,
            subItemCount: agingRows.filter(
              (r) => r.sourceType === 'sub_payment',
            ).length,
            billItemCount: agingRows.filter((r) => r.sourceType === 'bill')
              .length,
            payrollItemCount: agingRows.filter(
              (r) => r.sourceType === 'payroll',
            ).length,
          },
          commitmentRows,
          committedTotal: commitmentRows.reduce((s, c) => s + c.remaining, 0),
        };
      })()
    : fullReport;

  return (
    <ReportShell
      type="accounts-payable"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: p.name }))}
      companyName={company.name}
    >
      <ApDefaultTermsPicker selected={defaultTermsDays} />
      <ApVendorPicker
        selected={vendorId}
        vendors={fullReport.vendorRows.map((v) => ({
          id: v.vendorId,
          name: v.vendorName,
        }))}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI
          label="Total AP"
          value={formatMoney(report.summary.totalAP)}
          hint={`${report.summary.billItemCount} bill${report.summary.billItemCount === 1 ? '' : 's'} · ${report.summary.payrollItemCount} payroll · ${report.summary.subItemCount} sub`}
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
        {report.summary.itemCount} unpaid obligation
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

      {fullReport.draftBills.count > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">
            {fullReport.draftBills.count} bill
            {fullReport.draftBills.count === 1 ? '' : 's'} still in draft
          </span>{' '}
          ({formatMoney(fullReport.draftBills.total)}) — a draft carries no
          liability, so it is not on this report until it is approved &amp;
          posted.{' '}
          <Link
            href={{ pathname: '/banking/receipts' }}
            className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
          >
            Review drafts
          </Link>
        </div>
      )}

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
          <CardTitle>Unpaid bills &amp; obligations</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {report.agingRows.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              Nothing outstanding — every posted bill, payroll run and
              subcontractor payment has been settled.
            </p>
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
                      ) : r.sourceType === 'bill' ? (
                        <Link
                          href={{ pathname: `/banking/receipts/${r.sourceId}` }}
                          className="font-mono text-blue-700 underline underline-offset-2 hover:text-blue-900"
                          title="Open this bill"
                        >
                          {r.sourceLabel}
                        </Link>
                      ) : r.sourceType === 'payroll' ? (
                        <Link
                          href={{ pathname: '/payroll/bills' }}
                          className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
                          title="Open the payroll bills page"
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
                    <TableCell className="text-right tabular-nums font-medium">
                      {r.sourceType === 'bill' || r.sourceType === 'payroll' ? (
                        <Link
                          href={{
                            pathname:
                              r.sourceType === 'bill'
                                ? `/banking/receipts/${r.sourceId}`
                                : '/payroll/bills',
                          }}
                          className="text-amber-700 underline underline-offset-2 hover:text-amber-900"
                        >
                          {formatMoney(r.amount)}
                        </Link>
                      ) : (
                        <span className="text-amber-700">
                          {formatMoney(r.amount)}
                        </span>
                      )}
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

      <Card>
        <CardHeader>
          <CardTitle>
            Open purchase orders — committed, not yet payable{' '}
            <span className="text-slate-500 font-normal">
              ({formatMoney(report.committedTotal)})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <p className="px-6 pt-4 text-sm text-slate-600">
            A purchase order is an order placed, not money owed. It becomes
            accounts payable when the vendor bills it — use{' '}
            <span className="font-medium">Create bill from PO</span> on the PO.
            These amounts are deliberately excluded from the AP totals above.
          </p>
          {report.commitmentRows.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No open POs.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Order date</TableHead>
                  <TableHead className="text-right">Not yet billed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.commitmentRows.map((c) => (
                  <TableRow key={c.poId}>
                    <TableCell className="text-xs">
                      <Link
                        href={{ pathname: `/purchase-orders/${c.poId}` }}
                        className="font-mono text-blue-700 underline underline-offset-2 hover:text-blue-900"
                      >
                        {c.number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-700">
                      {c.vendorName}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {c.projectName ?? <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {c.issueDate}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-700">
                      {formatMoney(c.remaining)}
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

