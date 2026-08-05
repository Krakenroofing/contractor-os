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
import { buildVendorVatReport } from '@/modules/reports/lib/reports';
import { ReportShell } from '@/modules/reports/components/report-shell';

export const dynamic = 'force-dynamic';

export default async function VendorVatReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  // Non-VAT company (e.g. Kraken Roofing LLC, US) → no VAT reports.
  if (!company.isVatActive) redirect('/reports');
  const filters = parseReportFilters(await searchParams);
  const [report, projects] = await Promise.all([
    buildVendorVatReport(company.id, filters),
    listProjects(company.id),
  ]);

  const { rows, totals, coverage } = report;
  const hasRows = rows.length > 0;

  return (
    <ReportShell
      type="vendor-vat"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: p.name }))}
      companyName={company.name}
    >
      {/* ===== Summary ===== */}
      <Card>
        <CardHeader>
          <CardTitle>VAT vendor totals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Gross paid (VAT vendors)
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                {formatMoney(totals.gross)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {totals.transactionCount} expense
                {totals.transactionCount === 1 ? '' : 's'} ·{' '}
                {rows.length} vendor{rows.length === 1 ? '' : 's'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Material cost (ex-VAT)
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                {formatMoney(totals.net)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                VAT paid (recoverable input)
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">
                {formatMoney(totals.vat)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== Coverage note ===== */}
      {(coverage.unassignedGross > 0 || coverage.nonVatVendorGross > 0) && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">
            This report only counts expenses with a VAT vendor selected.
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Of {formatMoney(coverage.totalExpenseGross)} total expenses in this
            range:{' '}
            <span className="font-medium">
              {formatMoney(coverage.vatVendorGross)}
            </span>{' '}
            is on VAT vendors (broken out above),{' '}
            <span className="font-medium">
              {formatMoney(coverage.nonVatVendorGross)}
            </span>{' '}
            is on vendors with no VAT rate, and{' '}
            <span className="font-medium">
              {formatMoney(coverage.unassignedGross)}
            </span>{' '}
            ({coverage.unassignedCount} transaction
            {coverage.unassignedCount === 1 ? '' : 's'}) has no vendor set yet.
            Set the payee on those expenses to include them.
          </p>
        </div>
      )}

      {/* ===== Per-vendor breakdown ===== */}
      <Card>
        <CardHeader>
          <CardTitle>By vendor</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {!hasRows ? (
            <p className="p-6 text-sm text-slate-500">
              No VAT-vendor expenses in this range. Set a VAT rate on the
              vendor (Vendors → edit → VAT rate %) and select that vendor as
              the payee on its bank expenses.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Txns</TableHead>
                  <TableHead className="text-right">Gross paid</TableHead>
                  <TableHead className="text-right">Material (ex-VAT)</TableHead>
                  <TableHead className="text-right">VAT paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.vendorId}>
                    <TableCell className="font-medium text-slate-900">
                      {r.vendorName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {r.ratePercent}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {r.transactionCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(r.gross)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(r.net)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">
                      {formatMoney(r.vat)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-slate-300 font-semibold">
                  <TableCell className="text-slate-900">Totals</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">
                    {totals.transactionCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(totals.gross)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(totals.net)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">
                    {formatMoney(totals.vat)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  );
}
